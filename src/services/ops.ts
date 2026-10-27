import { and, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { assignments, contractors, opsAudit, sites, timeEntries } from "@/db/schema";
import { sha256Bytes } from "@/lib/crypto";
import {
  OPS_SELECT_ROW_CAP,
  planOpsSql,
  readOpsConfirmToken,
  selectCapSql,
  signOpsConfirmToken,
  whereParams,
  type OpsRow,
  type OpsSqlPlan,
  type OpsSqlRunner,
  type SqlValue,
} from "@/lib/ops-sql";
import { requireOwnerBusinessId } from "@/lib/business";
import {
  activeForEngagementStatus,
  archiveWritePlan,
  engagementStatusWritePlan,
  isEngagementStatus,
  restoreWritePlan,
  type ContractorEngagementPatch,
  type EngagementStatus,
  type LifecycleWrite,
} from "@/lib/contractor-lifecycle";
import { summarizeWeek, weekEnd, weekPayrollTotals, weekStartFromDate } from "@/lib/payroll";
import { summarizeWeekBySite } from "@/lib/week-rollup";
import { assertUnlockedWeek } from "@/services/week-approval";
import {
  createContractor,
  createTimeEntry,
  deleteTimeEntry,
  getContractor,
  updateContractor,
  updateTimeEntry,
  type TimeEntryWriteOptions,
} from "@/services/timesheet";
import type { z } from "zod";
import type { timeEntryInput, timeEntryUpdateInput } from "@/lib/validation";

type Database = typeof db;
type TimeEntryCreate = z.infer<typeof timeEntryInput>;
type TimeEntryUpdate = z.infer<typeof timeEntryUpdateInput>;

export const LONG_DAY_MINUTES = 14 * 60;

const ACTION = {
  contractorCreate: "contractor.create",
  contractorUpdate: "contractor.update",
  contractorRate: "contractor.rate",
  contractorArchive: "contractor.archive",
  contractorRestore: "contractor.restore",
  timeEntryCreate: "time_entry.create",
  timeEntryUpdate: "time_entry.update",
  sqlInsert: "sql.insert",
  sqlUpdate: "sql.update",
  revert: "revert",
} as const;

const AUDIT_INSERT = "INSERT INTO ops_audit (id, action, sql_text, params_json, old_json, new_json, reason, row_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

const ENTRY_MODES = new Set(["clock", "paid_hours", "absent"]);
const OCCURRENCE_KINDS = new Set(["manual", "scheduled", "worked", "absent", "hours_override"]);

type ContractorSnapshot = {
  id: string;
  ownerUserId: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  active: boolean;
  engagementStatus: EngagementStatus;
};

type OpsContractor = {
  id: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  currency: "NZD";
  active: boolean;
  engagementStatus: EngagementStatus;
};

type TimeEntrySnapshot = {
  id: string;
  ownerUserId: string;
  contractorId: string;
  siteId: string;
  workDate: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  paidMinutes: number;
  rateCents: number;
  notes: string;
  entryMode: "clock" | "paid_hours" | "absent";
  occurrenceKind: "manual" | "scheduled" | "worked" | "absent" | "hours_override";
  scheduleVersionId: string | null;
};

type ContractorWrite = {
  ownerUserId: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  reason: string;
};

type OwnerReason = { ownerUserId: string; reason: string };

export async function opsCreateContractor(database: Database, input: ContractorWrite & ContractorEngagementPatch) {
  const created = await createContractor(database, input.ownerUserId, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    defaultRateCents: input.defaultRateCents,
    preferredName: input.preferredName,
    startDate: input.startDate,
    engagementStatus: input.engagementStatus,
    gstRegistered: input.gstRegistered,
    gstNumber: input.gstNumber,
    internalNotes: input.internalNotes,
    emergencyContactName: input.emergencyContactName,
    emergencyContactPhone: input.emergencyContactPhone,
  });
  const snapshot = await requireContractor(database, input.ownerUserId, created.id);
  const auditId = await writeAudit(database, {
    action: ACTION.contractorCreate,
    oldJson: null,
    newJson: snapshot,
    reason: input.reason,
    rowCount: 1,
  });
  return { contractor: opsContractor(created), auditId };
}

export async function opsUpdateContractor(
  database: Database,
  contractorId: string,
  input: Omit<ContractorWrite, "defaultRateCents">,
) {
  const before = await requireContractor(database, input.ownerUserId, contractorId);
  const contractor = await updateContractor(database, input.ownerUserId, contractorId, {
    name: input.name,
    email: input.email,
    phone: input.phone,
    defaultRateCents: before.defaultRateCents,
  });
  const after = await requireContractor(database, input.ownerUserId, contractorId);
  const auditId = await writeAudit(database, {
    action: ACTION.contractorUpdate,
    oldJson: before,
    newJson: after,
    reason: input.reason,
    rowCount: 1,
  });
  return { contractor: opsContractor(contractor), auditId };
}

export async function opsChangeContractorRate(
  database: Database,
  contractorId: string,
  input: OwnerReason & { defaultRateCents: number },
) {
  const before = await requireContractor(database, input.ownerUserId, contractorId);
  const contractor = await updateContractor(database, input.ownerUserId, contractorId, {
    name: before.name,
    email: before.email,
    phone: before.phone,
    defaultRateCents: input.defaultRateCents,
  });
  const after = await requireContractor(database, input.ownerUserId, contractorId);
  const auditId = await writeAudit(database, {
    action: ACTION.contractorRate,
    oldJson: before,
    newJson: after,
    reason: input.reason,
    rowCount: 1,
  });
  return { contractor: opsContractor(contractor), auditId };
}

export async function opsArchiveContractor(database: Database, contractorId: string, input: OwnerReason) {
  return changeContractorActive(database, contractorId, input, false);
}

export async function opsRestoreContractor(database: Database, contractorId: string, input: OwnerReason) {
  return changeContractorActive(database, contractorId, input, true);
}

export async function opsCreateTimeEntry(
  database: Database,
  input: TimeEntryCreate & OwnerReason & { confirmLockedWeek?: boolean },
) {
  const options = lockOptions(input.confirmLockedWeek);
  const { ownerUserId, reason, confirmLockedWeek: _confirm, ...entry } = input;
  const created = await createTimeEntry(database, ownerUserId, entry, options);
  const snapshot = timeEntrySnapshot(created);
  const auditId = await writeAudit(database, {
    action: ACTION.timeEntryCreate,
    oldJson: null,
    newJson: snapshot,
    reason,
    rowCount: 1,
  });
  return { ...(await longDayReport(database, ownerUserId, snapshot)), entry: publicEntry(snapshot), auditId };
}

export async function opsUpdateTimeEntry(
  database: Database,
  entryId: string,
  input: TimeEntryUpdate & OwnerReason & { confirmLockedWeek?: boolean },
) {
  const before = await requireTimeEntry(database, input.ownerUserId, entryId);
  const options = lockOptions(input.confirmLockedWeek);
  const { ownerUserId, reason, confirmLockedWeek: _confirm, ...entry } = input;
  const updated = await updateTimeEntry(database, ownerUserId, entryId, entry, options);
  const after = timeEntrySnapshot(updated);
  const auditId = await writeAudit(database, {
    action: ACTION.timeEntryUpdate,
    oldJson: before,
    newJson: after,
    reason,
    rowCount: 1,
  });
  const report = await longDayReport(database, ownerUserId, after, before);
  return { ...report, entry: publicEntry(after), auditId };
}

export async function opsWages(
  database: Database,
  input: { ownerUserId: string; weekStart: string; contractorId?: string; siteId?: string },
) {
  const businessId = await requireOwnerBusinessId(database, input.ownerUserId);
  const end = weekEnd(input.weekStart);
  const rows = await database.select({
    contractorId: timeEntries.contractorId,
    contractorName: contractors.name,
    siteId: timeEntries.siteId,
    siteName: sites.name,
    paidMinutes: timeEntries.paidMinutes,
    rateCents: timeEntries.rateCents,
  }).from(timeEntries)
    .innerJoin(contractors, and(
      eq(contractors.id, timeEntries.contractorId),
      eq(contractors.ownerUserId, input.ownerUserId),
      eq(contractors.businessId, businessId),
    ))
    .innerJoin(sites, and(
      eq(sites.id, timeEntries.siteId),
      eq(sites.ownerUserId, input.ownerUserId),
      eq(sites.businessId, businessId),
    ))
    .where(and(
      eq(timeEntries.ownerUserId, input.ownerUserId),
      eq(timeEntries.businessId, businessId),
      gte(timeEntries.workDate, input.weekStart),
      lte(timeEntries.workDate, end),
    ));
  const filtered = rows.filter((row) => (
    (!input.contractorId || row.contractorId === input.contractorId)
    && (!input.siteId || row.siteId === input.siteId)
  ));
  return {
    weekStart: input.weekStart,
    weekEnd: end,
    contractors: summarizeWeek(filtered),
    sites: summarizeWeekBySite(filtered),
    totals: weekPayrollTotals(filtered),
  };
}

export async function opsPreviewSql(
  runner: OpsSqlRunner,
  input: { sql: string; params: SqlValue[]; secret: string; nowMs: number },
) {
  const planned = planOpsSql(input.sql, input.params);
  if (!planned.ok) throw new Error(planned.error);
  if (planned.plan.kind === "select") {
    const rows = await runner.all(selectCapSql(planned.plan.sql), input.params);
    const truncated = rows.length > OPS_SELECT_ROW_CAP;
    const capped = truncated ? rows.slice(0, OPS_SELECT_ROW_CAP) : rows;
    return { kind: "select" as const, rows: capped, rowCount: capped.length, truncated };
  }
  const preview = await dryRun(runner, planned.plan, input.params);
  const signed = await signOpsConfirmToken({
    sql: planned.plan.sql,
    params: input.params,
    rowCount: preview.rowCount,
    nowMs: input.nowMs,
  }, input.secret);
  return {
    kind: "dry_run" as const,
    rowCount: preview.rowCount,
    sample: preview.sample,
    confirmToken: signed.token,
    expiresAt: signed.expiresAt,
  };
}

export async function opsExecuteSql(
  runner: OpsSqlRunner,
  input: { sql: string; params: SqlValue[]; confirmToken: string; reason: string; secret: string; nowMs: number },
) {
  const planned = planOpsSql(input.sql, input.params);
  if (!planned.ok) throw new Error(planned.error);
  if (planned.plan.kind === "select") throw new Error("invalid_sql");
  const token = await readOpsConfirmToken(input.confirmToken, input.secret, input.nowMs);
  if (!token.ok) throw new Error(token.error);
  if (token.payload.sql !== planned.plan.sql || JSON.stringify(token.payload.params) !== JSON.stringify(input.params)) {
    throw new Error("confirm_mismatch");
  }
  const preview = await dryRun(runner, planned.plan, input.params);
  if (preview.rowCount !== token.payload.rowCount) throw new Error("stale_preview");
  const confirm = await confirmHash(input.confirmToken);
  const used = await runner.all("SELECT id FROM ops_audit WHERE instr(params_json, ?) > 0 LIMIT 1", [confirmMarker(confirm)]);
  if (used.length > 0) throw new Error("confirm_used");
  const auditId = crypto.randomUUID();
  const action = planned.plan.kind === "update" ? ACTION.sqlUpdate : ACTION.sqlInsert;
  await runner.batch([
    { sql: planned.plan.sql, params: input.params },
    {
      sql: AUDIT_INSERT,
      params: [
        auditId,
        action,
        planned.plan.sql,
        JSON.stringify({ confirm, params: input.params }),
        planned.plan.kind === "update" ? JSON.stringify(preview.sample) : null,
        planned.plan.kind === "update" ? JSON.stringify({ rowCount: preview.rowCount }) : JSON.stringify(preview.sample),
        input.reason,
        preview.rowCount,
        Math.floor(Date.now() / 1000),
      ],
    },
  ]);
  return { kind: "execute" as const, rowCount: preview.rowCount, auditId };
}

export async function opsRevert(
  database: Database,
  input: OwnerReason & { auditId: string; confirmLockedWeek?: boolean },
) {
  const [row] = await database.select().from(opsAudit).where(eq(opsAudit.id, input.auditId)).limit(1);
  if (!row) throw new Error("not_found");
  if (row.action === ACTION.revert || row.action === ACTION.sqlInsert || row.action === ACTION.sqlUpdate) {
    throw new Error("not_revertable");
  }
  const marker = JSON.stringify({ auditId: input.auditId });
  const [prior] = await database.select({ id: opsAudit.id }).from(opsAudit).where(and(
    eq(opsAudit.action, ACTION.revert),
    eq(opsAudit.paramsJson, marker),
  )).limit(1);
  if (prior) throw new Error("already_reverted");
  const reverted = await revertNamedAction(database, row.action, row.oldJson, row.newJson, input);
  const auditId = await writeAudit(database, {
    action: ACTION.revert,
    paramsJson: marker,
    oldJson: reverted.before,
    newJson: reverted.after,
    reason: input.reason,
    rowCount: 1,
  });
  return { auditId, revertedAuditId: input.auditId, action: row.action, ...reverted.body };
}

async function changeContractorActive(database: Database, contractorId: string, input: OwnerReason, active: boolean) {
  const before = await requireContractor(database, input.ownerUserId, contractorId);
  const businessId = await requireOwnerBusinessId(database, input.ownerUserId);
  const plan = active ? restoreWritePlan(input.ownerUserId, contractorId) : archiveWritePlan(input.ownerUserId, contractorId);
  await applyLifecycle(database, input.ownerUserId, businessId, plan);
  const after = await requireContractor(database, input.ownerUserId, contractorId);
  const auditId = await writeAudit(database, {
    action: active ? ACTION.contractorRestore : ACTION.contractorArchive,
    oldJson: before,
    newJson: after,
    reason: input.reason,
    rowCount: 1,
  });
  return { contractor: opsContractor(await getContractor(database, input.ownerUserId, contractorId)), auditId };
}

async function applyLifecycle(database: Database, ownerUserId: string, businessId: string, plan: LifecycleWrite[]) {
  const updatedAt = new Date();
  const assignment = plan.find((step) => step.table === "assignment");
  const contractor = plan.find((step) => step.table === "contractor");
  if (!contractor || !("id" in contractor.where) || !contractor.set.engagementStatus) {
    throw new Error("invalid_request");
  }
  if (contractor.where.ownerUserId !== ownerUserId) throw new Error("invalid_request");
  if (contractor.set.active !== activeForEngagementStatus(contractor.set.engagementStatus)) {
    throw new Error("invalid_request");
  }
  const contractorWrite = database.update(contractors).set({
    active: contractor.set.active,
    engagementStatus: contractor.set.engagementStatus,
    updatedAt,
  }).where(and(
    eq(contractors.id, contractor.where.id),
    eq(contractors.ownerUserId, contractor.where.ownerUserId),
    eq(contractors.businessId, businessId),
  ));
  if (!assignment) {
    await contractorWrite;
    return;
  }
  if (!("contractorId" in assignment.where) || assignment.where.ownerUserId !== ownerUserId) {
    throw new Error("invalid_request");
  }
  const assignmentWrite = database.update(assignments).set({ active: assignment.set.active, updatedAt }).where(and(
    eq(assignments.ownerUserId, assignment.where.ownerUserId),
    eq(assignments.businessId, businessId),
    eq(assignments.contractorId, assignment.where.contractorId),
  ));
  const writes = plan[0]?.table === "assignment" && plan[1]?.table === "contractor"
    ? [assignmentWrite, contractorWrite]
    : plan[0]?.table === "contractor" && plan[1]?.table === "assignment"
      ? [contractorWrite, assignmentWrite]
      : null;
  if (!writes) throw new Error("invalid_request");
  if (typeof database.batch === "function") {
    await database.batch(writes as unknown as Parameters<Database["batch"]>[0]);
    return;
  }
  for (const write of writes) await write;
}

async function revertNamedAction(
  database: Database,
  action: string,
  oldJson: string | null,
  newJson: string | null,
  input: OwnerReason & { confirmLockedWeek?: boolean },
) {
  if (action === ACTION.contractorCreate || action === ACTION.contractorUpdate || action === ACTION.contractorRate || action === ACTION.contractorArchive || action === ACTION.contractorRestore) {
    return revertContractor(database, action, oldJson, newJson, input.ownerUserId);
  }
  if (action === ACTION.timeEntryCreate || action === ACTION.timeEntryUpdate) {
    return revertTimeEntry(database, action, oldJson, newJson, input);
  }
  throw new Error("not_revertable");
}

async function revertContractor(
  database: Database,
  action: string,
  oldJson: string | null,
  newJson: string | null,
  ownerUserId: string,
) {
  const next = parseJson(newJson, isContractorSnapshot);
  if (!next || next.ownerUserId !== ownerUserId) throw new Error("not_found");
  const current = await requireContractor(database, ownerUserId, next.id);
  if (!sameContractor(current, next)) throw new Error("stale_preview");
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  if (action === ACTION.contractorCreate) {
    await applyLifecycle(database, ownerUserId, businessId, archiveWritePlan(ownerUserId, next.id));
  } else {
    const previous = parseJson(oldJson, isContractorSnapshot);
    if (!previous || previous.id !== next.id || previous.ownerUserId !== ownerUserId) throw new Error("not_revertable");
    if (action === ACTION.contractorArchive || action === ACTION.contractorRestore) {
      await applyLifecycle(database, ownerUserId, businessId, engagementStatusWritePlan(ownerUserId, next.id, previous.engagementStatus));
    } else {
      await updateContractor(database, ownerUserId, next.id, {
        name: previous.name,
        email: previous.email,
        phone: previous.phone,
        defaultRateCents: previous.defaultRateCents,
        engagementStatus: previous.engagementStatus,
      });
    }
  }
  const after = await requireContractor(database, ownerUserId, next.id);
  return {
    before: current,
    after,
    body: { contractor: opsContractor(await getContractor(database, ownerUserId, next.id)) },
  };
}

async function revertTimeEntry(
  database: Database,
  action: string,
  oldJson: string | null,
  newJson: string | null,
  input: OwnerReason & { confirmLockedWeek?: boolean },
) {
  const next = parseJson(newJson, isTimeEntrySnapshot);
  if (!next || next.ownerUserId !== input.ownerUserId) throw new Error("not_found");
  const current = await requireTimeEntry(database, input.ownerUserId, next.id);
  if (!sameTimeEntry(current, next)) throw new Error("stale_preview");
  const businessId = await requireOwnerBusinessId(database, input.ownerUserId);
  const options = lockOptions(input.confirmLockedWeek);
  if (action === ACTION.timeEntryCreate) {
    const deleted = await deleteTimeEntry(database, input.ownerUserId, next.id, options);
    if (!deleted) throw new Error("not_found");
    return { before: current, after: null, body: { deletedEntryId: next.id } };
  }
  const previous = parseJson(oldJson, isTimeEntrySnapshot);
  if (!previous || previous.id !== next.id || previous.ownerUserId !== input.ownerUserId) throw new Error("not_revertable");
  if (!options.confirmLockedWeek) {
    await assertUnlockedWeek(database, input.ownerUserId, current.workDate, businessId);
    await assertUnlockedWeek(database, input.ownerUserId, previous.workDate, businessId);
  }
  await database.update(timeEntries).set({
    contractorId: previous.contractorId,
    siteId: previous.siteId,
    workDate: previous.workDate,
    startMinutes: previous.startMinutes,
    endMinutes: previous.endMinutes,
    breakMinutes: previous.breakMinutes,
    paidMinutes: previous.paidMinutes,
    rateCents: previous.rateCents,
    notes: previous.notes,
    entryMode: previous.entryMode,
    occurrenceKind: previous.occurrenceKind,
    scheduleVersionId: previous.scheduleVersionId,
    updatedAt: new Date(),
  }).where(and(
    eq(timeEntries.id, previous.id),
    eq(timeEntries.ownerUserId, input.ownerUserId),
    eq(timeEntries.businessId, businessId),
  ));
  const after = await requireTimeEntry(database, input.ownerUserId, previous.id);
  return { before: current, after, body: { entry: publicEntry(after) } };
}

async function dryRun(runner: OpsSqlRunner, plan: Exclude<OpsSqlPlan, { kind: "select" }>, params: SqlValue[]) {
  if (plan.kind === "insert_values") return { rowCount: plan.rowCount, sample: plan.sample };
  if (plan.kind === "insert_select") {
    return { rowCount: await countRows(runner, plan.countSql, params), sample: await runner.all(plan.sampleSql, params) };
  }
  const bound = whereParams(params, plan.whereParamOffset);
  return { rowCount: await countRows(runner, plan.countSql, bound), sample: await runner.all(plan.sampleSql, bound) };
}

async function countRows(runner: OpsSqlRunner, sql: string, params: SqlValue[]) {
  const rows = await runner.all(sql, params);
  const value = rows[0] ? Object.values(rows[0])[0] : undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw new Error("invalid_sql");
  return value;
}

async function confirmHash(token: string) {
  const bytes = await sha256Bytes(token);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function confirmMarker(confirm: string) {
  return `"confirm":"${confirm}"`;
}

async function longDayReport(database: Database, ownerUserId: string, current: TimeEntrySnapshot, previous?: TimeEntrySnapshot) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const targets = [{ contractorId: current.contractorId, workDate: current.workDate }];
  if (previous && (previous.contractorId !== current.contractorId || previous.workDate !== current.workDate)) {
    targets.push({ contractorId: previous.contractorId, workDate: previous.workDate });
  }
  const longDays: Array<{ contractorId: string; workDate: string; paidMinutes: number }> = [];
  let dayPaidMinutes = 0;
  for (const [index, target] of targets.entries()) {
    const paidMinutes = await contractorDayMinutes(database, ownerUserId, businessId, target.contractorId, target.workDate);
    if (index === 0) dayPaidMinutes = paidMinutes;
    if (paidMinutes > LONG_DAY_MINUTES) longDays.push({ ...target, paidMinutes });
  }
  return { dayPaidMinutes, longDay: longDays.length > 0, longDays };
}

async function contractorDayMinutes(
  database: Database,
  ownerUserId: string,
  businessId: string,
  contractorId: string,
  workDate: string,
) {
  const rows = await database.select({ paidMinutes: timeEntries.paidMinutes }).from(timeEntries).where(and(
    eq(timeEntries.ownerUserId, ownerUserId),
    eq(timeEntries.businessId, businessId),
    eq(timeEntries.contractorId, contractorId),
    eq(timeEntries.workDate, workDate),
  ));
  return rows.reduce((sum, row) => sum + row.paidMinutes, 0);
}

async function requireContractor(database: Database, ownerUserId: string, contractorId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [row] = await database.select({
    id: contractors.id,
    ownerUserId: contractors.ownerUserId,
    name: contractors.name,
    email: contractors.email,
    phone: contractors.phone,
    defaultRateCents: contractors.defaultRateCents,
    active: contractors.active,
    engagementStatus: contractors.engagementStatus,
  }).from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  if (!row) throw new Error("not_found");
  return row;
}

async function requireTimeEntry(database: Database, ownerUserId: string, entryId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [row] = await database.select().from(timeEntries).where(and(
    eq(timeEntries.id, entryId),
    eq(timeEntries.ownerUserId, ownerUserId),
    eq(timeEntries.businessId, businessId),
  )).limit(1);
  if (!row) throw new Error("not_found");
  return timeEntrySnapshot(row);
}

function timeEntrySnapshot(row: TimeEntrySnapshot): TimeEntrySnapshot {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    contractorId: row.contractorId,
    siteId: row.siteId,
    workDate: row.workDate,
    startMinutes: row.startMinutes,
    endMinutes: row.endMinutes,
    breakMinutes: row.breakMinutes,
    paidMinutes: row.paidMinutes,
    rateCents: row.rateCents,
    notes: row.notes,
    entryMode: row.entryMode,
    occurrenceKind: row.occurrenceKind,
    scheduleVersionId: row.scheduleVersionId,
  };
}

function publicEntry(row: TimeEntrySnapshot) {
  const { ownerUserId: _owner, ...entry } = row;
  return entry;
}

function lockOptions(confirmLockedWeek: boolean | undefined): TimeEntryWriteOptions {
  return { confirmLockedWeek: confirmLockedWeek === true };
}

async function writeAudit(database: Database, input: {
  action: string;
  sqlText?: string | null;
  paramsJson?: string | null;
  oldJson: unknown;
  newJson: unknown;
  reason: string;
  rowCount: number;
}) {
  const id = crypto.randomUUID();
  await database.insert(opsAudit).values({
    id,
    action: input.action,
    sqlText: input.sqlText ?? null,
    paramsJson: input.paramsJson ?? null,
    oldJson: input.oldJson == null ? null : JSON.stringify(input.oldJson),
    newJson: input.newJson == null ? null : JSON.stringify(input.newJson),
    reason: input.reason,
    rowCount: input.rowCount,
    createdAt: new Date(),
  });
  return id;
}

function parseJson<T>(json: string | null, guard: (value: unknown) => value is T): T | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isContractorSnapshot(value: unknown): value is ContractorSnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.ownerUserId === "string"
    && typeof row.name === "string"
    && typeof row.email === "string"
    && typeof row.phone === "string"
    && Number.isInteger(row.defaultRateCents)
    && typeof row.active === "boolean"
    && typeof row.engagementStatus === "string"
    && isEngagementStatus(row.engagementStatus);
}

function isTimeEntrySnapshot(value: unknown): value is TimeEntrySnapshot {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string"
    && typeof row.ownerUserId === "string"
    && typeof row.contractorId === "string"
    && typeof row.siteId === "string"
    && typeof row.workDate === "string"
    && Number.isInteger(row.startMinutes)
    && Number.isInteger(row.endMinutes)
    && Number.isInteger(row.breakMinutes)
    && Number.isInteger(row.paidMinutes)
    && Number.isInteger(row.rateCents)
    && typeof row.notes === "string"
    && typeof row.entryMode === "string"
    && ENTRY_MODES.has(row.entryMode)
    && typeof row.occurrenceKind === "string"
    && OCCURRENCE_KINDS.has(row.occurrenceKind)
    && (row.scheduleVersionId === null || typeof row.scheduleVersionId === "string");
}

function sameContractor(left: ContractorSnapshot, right: ContractorSnapshot) {
  return left.id === right.id
    && left.ownerUserId === right.ownerUserId
    && left.name === right.name
    && left.email === right.email
    && left.phone === right.phone
    && left.defaultRateCents === right.defaultRateCents
    && left.active === right.active
    && left.engagementStatus === right.engagementStatus;
}

function opsContractor(contractor: OpsContractor): OpsContractor {
  return {
    id: contractor.id,
    name: contractor.name,
    email: contractor.email,
    phone: contractor.phone,
    defaultRateCents: contractor.defaultRateCents,
    currency: contractor.currency,
    active: contractor.active,
    engagementStatus: contractor.engagementStatus,
  };
}

function sameTimeEntry(left: TimeEntrySnapshot, right: TimeEntrySnapshot) {
  return JSON.stringify(left) === JSON.stringify(right);
}
