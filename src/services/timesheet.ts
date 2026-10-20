import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { db } from "@/db/client";
import { assignmentScheduleVersions, assignments, contractors, sites, timeEntries } from "@/db/schema";
import {
  applyInlineAssignSiteAfterPrecheck,
  runCreateAssignment,
  runGetAssignment,
  runListAssignments,
  runRestoreAssignment,
  runUnassignAssignment,
  runUpdateAssignmentRate,
  type AssignmentPatch,
  type AssignmentRepository,
  type JoinedAssignment,
} from "@/lib/assignment";
import {
  contractorUpdateWriteSet,
  contractorVisibleInList,
  engagementAssignmentEffect,
  engagementColumnsForCreate,
  mapContractorWriteError,
  requireOwnedContractor,
  toContractorResource,
} from "@/lib/contractor-lifecycle";
import { ownerBusinessIdOrNull, requireOwnerBusinessId } from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { summarizeWeek, weekEnd } from "@/lib/payroll";
import { decodeWeekdays } from "@/lib/schedule";
import { clockFieldsForWrite, hasDuplicateTimeEntry, rateCentsForUpdate, shouldResnapshotRate } from "@/lib/time-entry-write";
import { findWeekApproval } from "@/lib/week-approval-query";
import { assertUnlockedWeek, toDashboardApproval } from "@/services/week-approval";
import type { z } from "zod";
import type { assignmentInput, assignmentRateInput, contractorInput, timeEntryInput, timeEntryUpdateInput } from "@/lib/validation";

export { createSite } from "@/services/sites";

type Database = typeof db;
type ContractorInput = z.infer<typeof contractorInput>;
type AssignmentInput = z.infer<typeof assignmentInput>;
type AssignmentRateInput = z.infer<typeof assignmentRateInput>;
type TimeEntryInput = z.infer<typeof timeEntryInput>;
type TimeEntryUpdateInput = z.infer<typeof timeEntryUpdateInput>;

const now = () => new Date();
const id = () => crypto.randomUUID();
const assignmentClock = { id, now };

export type TimeEntryWriteOptions = {
  confirmLockedWeek?: boolean;
};

const assignmentRecordColumns = {
  id: assignments.id,
  ownerUserId: assignments.ownerUserId,
  contractorId: assignments.contractorId,
  siteId: assignments.siteId,
  rateCents: assignments.rateCents,
  active: assignments.active,
  createdAt: assignments.createdAt,
  updatedAt: assignments.updatedAt,
};

const assignmentViewColumns = {
  id: assignments.id,
  contractorId: assignments.contractorId,
  contractorName: contractors.name,
  contractorDefaultRateCents: contractors.defaultRateCents,
  contractorActive: contractors.active,
  siteId: assignments.siteId,
  siteName: sites.name,
  siteActive: sites.active,
  rateCents: assignments.rateCents,
  active: assignments.active,
  createdAt: assignments.createdAt,
  updatedAt: assignments.updatedAt,
};

function assignmentRepo(database: Database, businessId: string): AssignmentRepository {
  return {
    async getContractor(ownerUserId, contractorId) {
      const [row] = await database.select({
        id: contractors.id,
        ownerUserId: contractors.ownerUserId,
        name: contractors.name,
        defaultRateCents: contractors.defaultRateCents,
        active: contractors.active,
      }).from(contractors).where(and(
        eq(contractors.id, contractorId),
        eq(contractors.ownerUserId, ownerUserId),
        eq(contractors.businessId, businessId),
      )).limit(1);
      return row;
    },
    async getSite(ownerUserId, siteId) {
      const [row] = await database.select({
        id: sites.id,
        ownerUserId: sites.ownerUserId,
        name: sites.name,
        active: sites.active,
      }).from(sites).where(and(
        eq(sites.id, siteId),
        eq(sites.ownerUserId, ownerUserId),
        eq(sites.businessId, businessId),
      )).limit(1);
      return row;
    },
    async getAssignmentByPair(ownerUserId, contractorId, siteId) {
      const [row] = await database.select(assignmentRecordColumns).from(assignments).where(and(
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
        eq(assignments.contractorId, contractorId),
        eq(assignments.siteId, siteId),
      )).limit(1);
      return row;
    },
    async getAssignmentById(ownerUserId, assignmentId) {
      const [row] = await database.select(assignmentRecordColumns).from(assignments).where(and(
        eq(assignments.id, assignmentId),
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
      )).limit(1);
      return row;
    },
    async insertAssignment(row) {
      await database.insert(assignments).values({ ...row, businessId });
    },
    async updateAssignment(ownerUserId, assignmentId, patch: AssignmentPatch) {
      const set: { updatedAt: Date; active?: boolean; rateCents?: number | null } = { updatedAt: patch.updatedAt };
      if (patch.active !== undefined) set.active = patch.active;
      if (Object.prototype.hasOwnProperty.call(patch, "rateCents")) set.rateCents = patch.rateCents;
      await database.update(assignments).set(set).where(and(
        eq(assignments.id, assignmentId),
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
      ));
    },
    async listJoinedAssignments(ownerUserId) {
      return database.select(assignmentViewColumns).from(assignments)
        .innerJoin(contractors, and(
          eq(contractors.id, assignments.contractorId),
          eq(contractors.ownerUserId, ownerUserId),
          eq(contractors.businessId, businessId),
        ))
        .innerJoin(sites, and(
          eq(sites.id, assignments.siteId),
          eq(sites.ownerUserId, ownerUserId),
          eq(sites.businessId, businessId),
        ))
        .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.businessId, businessId)))
        .orderBy(asc(contractors.name), asc(sites.name)) as Promise<JoinedAssignment[]>;
    },
    async getJoinedAssignment(ownerUserId, assignmentId) {
      const [row] = await database.select(assignmentViewColumns).from(assignments)
        .innerJoin(contractors, and(
          eq(contractors.id, assignments.contractorId),
          eq(contractors.ownerUserId, ownerUserId),
          eq(contractors.businessId, businessId),
        ))
        .innerJoin(sites, and(
          eq(sites.id, assignments.siteId),
          eq(sites.ownerUserId, ownerUserId),
          eq(sites.businessId, businessId),
        ))
        .where(and(
          eq(assignments.ownerUserId, ownerUserId),
          eq(assignments.businessId, businessId),
          eq(assignments.id, assignmentId),
        ))
        .limit(1);
      return row as JoinedAssignment | undefined;
    },
  };
}

export async function createContractor(database: Database, ownerUserId: string, input: ContractorInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const engagement = engagementColumnsForCreate(input);
  const row = {
    id: id(),
    ownerUserId,
    businessId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    defaultRateCents: input.defaultRateCents,
    currency: "NZD" as const,
    ...engagement,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await database.insert(contractors).values(row);
  } catch (error) {
    mapContractorWriteError(error);
  }
  return toContractorResource(row);
}

export async function listContractors(database: Database, ownerUserId: string, includeArchived: boolean) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) return [];
  const rows = await database.select().from(contractors).where(and(
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).orderBy(asc(contractors.name));
  return rows.filter((row) => contractorVisibleInList(row, includeArchived)).map(toContractorResource);
}

export async function getContractor(database: Database, ownerUserId: string, contractorId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) throw new Error("not_found");
  const [row] = await database.select().from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  return toContractorResource(requireOwnedContractor(row));
}

export async function updateContractor(database: Database, ownerUserId: string, contractorId: string, input: ContractorInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [existing] = await database.select({
    id: contractors.id,
    engagementStatus: contractors.engagementStatus,
  }).from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  const current = requireOwnedContractor(existing);
  const updatedAt = now();
  const write = contractorUpdateWriteSet(input, updatedAt);
  const effect = input.engagementStatus === undefined
    ? "none"
    : engagementAssignmentEffect(current.engagementStatus, input.engagementStatus);
  const ownedContractor = and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  );
  const ownedAssignments = and(
    eq(assignments.ownerUserId, ownerUserId),
    eq(assignments.businessId, businessId),
    eq(assignments.contractorId, contractorId),
  );
  try {
    if (effect === "none") {
      const [updated] = await database.update(contractors).set(write).where(ownedContractor).returning();
      return toContractorResource(requireOwnedContractor(updated));
    }
    const assignmentActive = effect === "reactivate";
    const assignmentWrite = database.update(assignments).set({ active: assignmentActive, updatedAt }).where(ownedAssignments);
    const contractorWrite = database.update(contractors).set(write).where(ownedContractor).returning();
    if (effect === "deactivate") {
      const [, updatedRows] = typeof database.batch === "function"
        ? await database.batch([assignmentWrite, contractorWrite])
        : [await assignmentWrite, await contractorWrite];
      return toContractorResource(requireOwnedContractor(updatedRows[0]));
    }
    const [updatedRows] = typeof database.batch === "function"
      ? await database.batch([contractorWrite, assignmentWrite])
      : [await contractorWrite, await assignmentWrite];
    return toContractorResource(requireOwnedContractor(updatedRows[0]));
  } catch (error) {
    mapContractorWriteError(error);
  }
}

async function ownedContractorId(database: Database, ownerUserId: string, businessId: string, contractorId: string) {
  const [existing] = await database.select({ id: contractors.id }).from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  return requireOwnedContractor(existing).id;
}

export async function archiveContractor(database: Database, ownerUserId: string, contractorId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const ownedId = await ownedContractorId(database, ownerUserId, businessId, contractorId);
  const updatedAt = now();
  const assignmentWrite = database.update(assignments).set({ active: false, updatedAt }).where(and(
    eq(assignments.ownerUserId, ownerUserId),
    eq(assignments.businessId, businessId),
    eq(assignments.contractorId, ownedId),
  ));
  const contractorWrite = database.update(contractors).set({ active: false, engagementStatus: "archived", updatedAt }).where(and(
    eq(contractors.id, ownedId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).returning();
  const [, updatedRows] = typeof database.batch === "function"
    ? await database.batch([assignmentWrite, contractorWrite])
    : [await assignmentWrite, await contractorWrite];
  return toContractorResource(requireOwnedContractor(updatedRows[0]));
}

export async function restoreContractor(database: Database, ownerUserId: string, contractorId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const ownedId = await ownedContractorId(database, ownerUserId, businessId, contractorId);
  const updatedAt = now();
  const contractorWrite = database.update(contractors).set({ active: true, engagementStatus: "active", updatedAt }).where(and(
    eq(contractors.id, ownedId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).returning();
  const assignmentWrite = database.update(assignments).set({ active: true, updatedAt }).where(and(
    eq(assignments.ownerUserId, ownerUserId),
    eq(assignments.businessId, businessId),
    eq(assignments.contractorId, ownedId),
  ));
  const [updatedRows] = typeof database.batch === "function"
    ? await database.batch([contractorWrite, assignmentWrite])
    : [await contractorWrite, await assignmentWrite];
  return toContractorResource(requireOwnedContractor(updatedRows[0]));
}

export async function createAssignment(database: Database, ownerUserId: string, input: AssignmentInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  return runCreateAssignment(assignmentRepo(database, businessId), ownerUserId, input, assignmentClock);
}

export type AssignmentScheduleCurrentView = {
  id: string;
  weekdays: number[];
  paidMinutes: number;
  effectiveFrom: string;
};

function toCurrentScheduleView(row: {
  id: string;
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
}): AssignmentScheduleCurrentView {
  return {
    id: row.id,
    weekdays: decodeWeekdays(row.weekdaysMask),
    paidMinutes: row.paidMinutes,
    effectiveFrom: row.effectiveFrom,
  };
}

async function loadOpenSchedulesByAssignment(database: Database, ownerUserId: string, businessId: string) {
  const rows = await database
    .select({
      id: assignmentScheduleVersions.id,
      assignmentId: assignmentScheduleVersions.assignmentId,
      weekdaysMask: assignmentScheduleVersions.weekdaysMask,
      paidMinutes: assignmentScheduleVersions.paidMinutes,
      effectiveFrom: assignmentScheduleVersions.effectiveFrom,
      effectiveTo: assignmentScheduleVersions.effectiveTo,
    })
    .from(assignmentScheduleVersions)
    .where(and(eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId)));
  const map = new Map<string, AssignmentScheduleCurrentView>();
  for (const row of rows) {
    if (row.effectiveTo != null) continue;
    map.set(row.assignmentId, toCurrentScheduleView(row));
  }
  return map;
}

export async function listAssignments(database: Database, ownerUserId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) return [];
  const rows = await runListAssignments(assignmentRepo(database, businessId), ownerUserId);
  const schedules = await loadOpenSchedulesByAssignment(database, ownerUserId, businessId);
  return rows.map((row) => ({ ...row, schedule: schedules.get(row.id) ?? null }));
}

export async function getAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) throw new Error("not_found");
  const row = await runGetAssignment(assignmentRepo(database, businessId), ownerUserId, assignmentId);
  const schedules = await loadOpenSchedulesByAssignment(database, ownerUserId, businessId);
  return { ...row, schedule: schedules.get(row.id) ?? null };
}

export async function updateAssignmentRate(database: Database, ownerUserId: string, assignmentId: string, input: AssignmentRateInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  return runUpdateAssignmentRate(assignmentRepo(database, businessId), ownerUserId, assignmentId, input.rateCents, assignmentClock);
}

export async function unassignAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  return runUnassignAssignment(assignmentRepo(database, businessId), ownerUserId, assignmentId, assignmentClock);
}

export async function restoreAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  return runRestoreAssignment(assignmentRepo(database, businessId), ownerUserId, assignmentId, assignmentClock);
}

export async function createTimeEntry(
  database: Database,
  ownerUserId: string,
  input: TimeEntryInput,
  options?: TimeEntryWriteOptions,
) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  // Validate paid duration before any assignment write so invalid_shift cannot restore a pair.
  const clock = clockFieldsForWrite(input);
  if (options?.confirmLockedWeek !== true) {
    await assertUnlockedWeek(database, ownerUserId, input.workDate, businessId);
  }

  await applyInlineAssignSiteAfterPrecheck(assignmentRepo(database, businessId), ownerUserId, input, assignmentClock, async () => {
    const [duplicate] = await database
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.ownerUserId, ownerUserId),
        eq(timeEntries.businessId, businessId),
        eq(timeEntries.contractorId, input.contractorId),
        eq(timeEntries.siteId, input.siteId),
        eq(timeEntries.workDate, input.workDate),
      ))
      .limit(1);
    if (duplicate) throw new Error("duplicate_entry");
  });

  const [match] = await database
    .select({ assignmentRate: assignments.rateCents, defaultRate: contractors.defaultRateCents })
    .from(assignments)
    .innerJoin(contractors, and(
      eq(contractors.id, assignments.contractorId),
      eq(contractors.ownerUserId, ownerUserId),
      eq(contractors.businessId, businessId),
      eq(contractors.active, true),
    ))
    .innerJoin(sites, and(
      eq(sites.id, assignments.siteId),
      eq(sites.ownerUserId, ownerUserId),
      eq(sites.businessId, businessId),
      eq(sites.active, true),
    ))
    .where(and(
      eq(assignments.ownerUserId, ownerUserId),
      eq(assignments.businessId, businessId),
      eq(assignments.contractorId, input.contractorId),
      eq(assignments.siteId, input.siteId),
      eq(assignments.active, true),
    ))
    .limit(1);
  if (!match) throw new Error("not_found");

  const row = {
    id: id(),
    ownerUserId,
    businessId,
    contractorId: input.contractorId,
    siteId: input.siteId,
    workDate: input.workDate,
    notes: input.notes,
    ...clock,
    rateCents: match.assignmentRate ?? match.defaultRate,
    occurrenceKind: "manual" as const,
    scheduleVersionId: null,
    createdAt: now(),
    updatedAt: now(),
  };
  try {
    await database.insert(timeEntries).values(row);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_entry");
    throw error;
  }
  return row;
}

export async function getTimeEntry(database: Database, ownerUserId: string, entryId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) return null;
  const [row] = await database.select({
    id: timeEntries.id, contractorId: timeEntries.contractorId, contractorName: contractors.name,
    siteId: timeEntries.siteId, siteName: sites.name, workDate: timeEntries.workDate,
    startMinutes: timeEntries.startMinutes, endMinutes: timeEntries.endMinutes,
    breakMinutes: timeEntries.breakMinutes, paidMinutes: timeEntries.paidMinutes,
    rateCents: timeEntries.rateCents, notes: timeEntries.notes, entryMode: timeEntries.entryMode,
    occurrenceKind: timeEntries.occurrenceKind, scheduleVersionId: timeEntries.scheduleVersionId,
  }).from(timeEntries)
    .innerJoin(contractors, and(
      eq(contractors.id, timeEntries.contractorId),
      eq(contractors.ownerUserId, ownerUserId),
      eq(contractors.businessId, businessId),
    ))
    .innerJoin(sites, and(
      eq(sites.id, timeEntries.siteId),
      eq(sites.ownerUserId, ownerUserId),
      eq(sites.businessId, businessId),
    ))
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
      eq(timeEntries.id, entryId),
    ))
    .limit(1);
  return row ?? null;
}

export async function updateTimeEntry(
  database: Database,
  ownerUserId: string,
  entryId: string,
  input: TimeEntryUpdateInput,
  options?: TimeEntryWriteOptions,
) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [existing] = await database
    .select()
    .from(timeEntries)
    .where(and(
      eq(timeEntries.id, entryId),
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
    ))
    .limit(1);
  if (!existing) throw new Error("not_found");
  if (options?.confirmLockedWeek !== true) {
    await assertUnlockedWeek(database, ownerUserId, existing.workDate, businessId);
    await assertUnlockedWeek(database, ownerUserId, input.workDate, businessId);
  }

  const clock = clockFieldsForWrite(input);
  const resnapshot = shouldResnapshotRate(existing, input);
  let assignmentEffectiveRate: number | null | undefined;
  if (resnapshot) {
    const [match] = await database
      .select({ assignmentRate: assignments.rateCents, defaultRate: contractors.defaultRateCents })
      .from(assignments)
      .innerJoin(contractors, and(
        eq(contractors.id, assignments.contractorId),
        eq(contractors.ownerUserId, ownerUserId),
        eq(contractors.businessId, businessId),
        eq(contractors.active, true),
      ))
      .innerJoin(sites, and(
        eq(sites.id, assignments.siteId),
        eq(sites.ownerUserId, ownerUserId),
        eq(sites.businessId, businessId),
        eq(sites.active, true),
      ))
      .where(and(
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
        eq(assignments.contractorId, input.contractorId),
        eq(assignments.siteId, input.siteId),
        eq(assignments.active, true),
      ))
      .limit(1);
    if (!match) throw new Error("not_found");
    assignmentEffectiveRate = match.assignmentRate ?? match.defaultRate;
  }
  const rateCents = rateCentsForUpdate({
    existingRateCents: existing.rateCents,
    resnapshot,
    assignmentEffectiveRate,
  });
  const scheduledKind = existing.occurrenceKind === "scheduled"
    || existing.occurrenceKind === "absent"
    || existing.occurrenceKind === "hours_override";
  const occurrenceKind = resnapshot
    ? "manual" as const
    : scheduledKind
      ? "hours_override" as const
      : existing.occurrenceKind;
  const scheduleVersionId = resnapshot ? null : existing.scheduleVersionId;

  const [duplicate] = await database
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
      eq(timeEntries.contractorId, input.contractorId),
      eq(timeEntries.siteId, input.siteId),
      eq(timeEntries.workDate, input.workDate),
      ne(timeEntries.id, entryId),
    ))
    .limit(1);
  if (hasDuplicateTimeEntry(entryId, duplicate?.id)) throw new Error("duplicate_entry");

  const updatedAt = now();
  try {
    const updated = await database
      .update(timeEntries)
      .set({
        contractorId: input.contractorId,
        siteId: input.siteId,
        workDate: input.workDate,
        notes: input.notes,
        ...clock,
        rateCents,
        occurrenceKind,
        scheduleVersionId,
        updatedAt,
      })
      .where(and(
        eq(timeEntries.id, entryId),
        eq(timeEntries.ownerUserId, ownerUserId),
        eq(timeEntries.businessId, businessId),
      ))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("not_found");
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_entry");
    throw error;
  }
}

export async function deleteTimeEntry(
  database: Database,
  ownerUserId: string,
  entryId: string,
  options?: TimeEntryWriteOptions,
): Promise<boolean> {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [existing] = await database
    .select({ id: timeEntries.id, workDate: timeEntries.workDate })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.id, entryId),
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
    ))
    .limit(1);
  if (!existing) return false;
  if (options?.confirmLockedWeek !== true) {
    await assertUnlockedWeek(database, ownerUserId, existing.workDate, businessId);
  }
  const deleted = await database.delete(timeEntries).where(and(
    eq(timeEntries.id, existing.id),
    eq(timeEntries.ownerUserId, ownerUserId),
    eq(timeEntries.businessId, businessId),
  )).returning({ id: timeEntries.id });
  return deleted.length === 1;
}

export async function getDashboard(database: Database, ownerUserId: string, weekStart: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const end = weekEnd(weekStart);
  const [siteRows, contractorRows, assignmentRows, entryRows, approvalRow, scheduleRows] = await Promise.all([
    database.select({ id: sites.id, name: sites.name, address: sites.address }).from(sites).where(and(
      eq(sites.ownerUserId, ownerUserId),
      eq(sites.businessId, businessId),
      eq(sites.active, true),
    )).orderBy(asc(sites.name)),
    database.select({ id: contractors.id, name: contractors.name, email: contractors.email, phone: contractors.phone, defaultRateCents: contractors.defaultRateCents, currency: contractors.currency }).from(contractors).where(and(
      eq(contractors.ownerUserId, ownerUserId),
      eq(contractors.businessId, businessId),
      eq(contractors.active, true),
    )).orderBy(asc(contractors.name)),
    database.select({ id: assignments.id, contractorId: assignments.contractorId, siteId: assignments.siteId, rateCents: assignments.rateCents }).from(assignments)
      .innerJoin(contractors, and(
        eq(contractors.id, assignments.contractorId),
        eq(contractors.ownerUserId, ownerUserId),
        eq(contractors.businessId, businessId),
        eq(contractors.active, true),
      ))
      .innerJoin(sites, and(
        eq(sites.id, assignments.siteId),
        eq(sites.ownerUserId, ownerUserId),
        eq(sites.businessId, businessId),
        eq(sites.active, true),
      ))
      .where(and(
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
        eq(assignments.active, true),
      )),
    database.select({
      id: timeEntries.id, contractorId: timeEntries.contractorId, contractorName: contractors.name,
      siteId: timeEntries.siteId, siteName: sites.name, workDate: timeEntries.workDate,
      startMinutes: timeEntries.startMinutes, endMinutes: timeEntries.endMinutes,
      breakMinutes: timeEntries.breakMinutes, paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents, notes: timeEntries.notes, entryMode: timeEntries.entryMode,
      occurrenceKind: timeEntries.occurrenceKind, scheduleVersionId: timeEntries.scheduleVersionId,
    }).from(timeEntries)
      .innerJoin(contractors, and(
        eq(contractors.id, timeEntries.contractorId),
        eq(contractors.ownerUserId, ownerUserId),
        eq(contractors.businessId, businessId),
      ))
      .innerJoin(sites, and(eq(sites.id, timeEntries.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.businessId, businessId)))
      .where(and(
        eq(timeEntries.ownerUserId, ownerUserId),
        eq(timeEntries.businessId, businessId),
        gte(timeEntries.workDate, weekStart),
        lte(timeEntries.workDate, end),
      ))
      .orderBy(asc(timeEntries.workDate), asc(contractors.name)),
    findWeekApproval(database, ownerUserId, weekStart, businessId),
    database.select({
      id: assignmentScheduleVersions.id,
      assignmentId: assignmentScheduleVersions.assignmentId,
      weekdaysMask: assignmentScheduleVersions.weekdaysMask,
      paidMinutes: assignmentScheduleVersions.paidMinutes,
      effectiveFrom: assignmentScheduleVersions.effectiveFrom,
      effectiveTo: assignmentScheduleVersions.effectiveTo,
    }).from(assignmentScheduleVersions).where(and(
      eq(assignmentScheduleVersions.ownerUserId, ownerUserId),
      eq(assignmentScheduleVersions.businessId, businessId),
    )),
  ]);
  const openSchedules = new Map<string, AssignmentScheduleCurrentView>();
  for (const row of scheduleRows) {
    if (row.effectiveTo != null) continue;
    openSchedules.set(row.assignmentId, toCurrentScheduleView(row));
  }
  return {
    weekStart, weekEnd: end, sites: siteRows, contractors: contractorRows,
    assignments: assignmentRows.map((row) => ({ ...row, schedule: openSchedules.get(row.id) ?? null })),
    entries: entryRows,
    summary: summarizeWeek(entryRows.map((entry) => ({ contractorId: entry.contractorId, contractorName: entry.contractorName, paidMinutes: entry.paidMinutes, rateCents: entry.rateCents }))),
    approval: toDashboardApproval(approvalRow),
  };
}
