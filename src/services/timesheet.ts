import { and, asc, eq, gte, lte, ne } from "drizzle-orm";
import type { db } from "@/db/client";
import { assignments, contractors, sites, timeEntries } from "@/db/schema";
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
  mapContractorWriteError,
  requireOwnedContractor,
  toContractorResource,
} from "@/lib/contractor-lifecycle";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { summarizeWeek, weekEnd } from "@/lib/payroll";
import { clockFieldsForWrite, hasDuplicateTimeEntry, rateCentsForUpdate, shouldResnapshotRate } from "@/lib/time-entry-write";
import { assertWeekUnlocked, getWeekApproval } from "@/services/week-approval";
import type { z } from "zod";
import type { assignmentInput, assignmentRateInput, contractorInput, timeEntryInput, timeEntryUpdateInput } from "@/lib/validation";

export { approveWeek, assertWeekUnlocked, getWeekApproval, reopenWeek } from "@/services/week-approval";
export type { WeekApprovalResource } from "@/services/week-approval";

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

function assignmentRepo(database: Database): AssignmentRepository {
  return {
    async getContractor(ownerUserId, contractorId) {
      const [row] = await database.select({
        id: contractors.id,
        ownerUserId: contractors.ownerUserId,
        name: contractors.name,
        defaultRateCents: contractors.defaultRateCents,
        active: contractors.active,
      }).from(contractors).where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId))).limit(1);
      return row;
    },
    async getSite(ownerUserId, siteId) {
      const [row] = await database.select({
        id: sites.id,
        ownerUserId: sites.ownerUserId,
        name: sites.name,
        active: sites.active,
      }).from(sites).where(and(eq(sites.id, siteId), eq(sites.ownerUserId, ownerUserId))).limit(1);
      return row;
    },
    async getAssignmentByPair(ownerUserId, contractorId, siteId) {
      const [row] = await database.select(assignmentRecordColumns).from(assignments).where(and(
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.contractorId, contractorId),
        eq(assignments.siteId, siteId),
      )).limit(1);
      return row;
    },
    async getAssignmentById(ownerUserId, assignmentId) {
      const [row] = await database.select(assignmentRecordColumns).from(assignments).where(and(
        eq(assignments.id, assignmentId),
        eq(assignments.ownerUserId, ownerUserId),
      )).limit(1);
      return row;
    },
    async insertAssignment(row) {
      await database.insert(assignments).values(row);
    },
    async updateAssignment(ownerUserId, assignmentId, patch: AssignmentPatch) {
      const set: { updatedAt: Date; active?: boolean; rateCents?: number | null } = { updatedAt: patch.updatedAt };
      if (patch.active !== undefined) set.active = patch.active;
      if (Object.prototype.hasOwnProperty.call(patch, "rateCents")) set.rateCents = patch.rateCents;
      await database.update(assignments).set(set).where(and(eq(assignments.id, assignmentId), eq(assignments.ownerUserId, ownerUserId)));
    },
    async listJoinedAssignments(ownerUserId) {
      return database.select(assignmentViewColumns).from(assignments)
        .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId)))
        .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId)))
        .where(eq(assignments.ownerUserId, ownerUserId))
        .orderBy(asc(contractors.name), asc(sites.name)) as Promise<JoinedAssignment[]>;
    },
    async getJoinedAssignment(ownerUserId, assignmentId) {
      const [row] = await database.select(assignmentViewColumns).from(assignments)
        .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId)))
        .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId)))
        .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.id, assignmentId)))
        .limit(1);
      return row as JoinedAssignment | undefined;
    },
  };
}

export async function createContractor(database: Database, ownerUserId: string, input: ContractorInput) {
  const row = { id: id(), ownerUserId, ...input, currency: "NZD" as const, active: true, createdAt: now(), updatedAt: now() };
  try {
    await database.insert(contractors).values(row);
  } catch (error) {
    mapContractorWriteError(error);
  }
  return toContractorResource(row);
}

export async function listContractors(database: Database, ownerUserId: string, includeArchived: boolean) {
  const rows = includeArchived
    ? await database.select().from(contractors).where(eq(contractors.ownerUserId, ownerUserId)).orderBy(asc(contractors.name))
    : await database.select().from(contractors).where(and(eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true))).orderBy(asc(contractors.name));
  return rows.map(toContractorResource);
}

export async function getContractor(database: Database, ownerUserId: string, contractorId: string) {
  const [row] = await database.select().from(contractors).where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId))).limit(1);
  return toContractorResource(requireOwnedContractor(row));
}

export async function updateContractor(database: Database, ownerUserId: string, contractorId: string, input: ContractorInput) {
  const [existing] = await database.select({ id: contractors.id }).from(contractors).where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId))).limit(1);
  requireOwnedContractor(existing);
  try {
    const [updated] = await database.update(contractors).set(contractorUpdateWriteSet(input, now())).where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId))).returning();
    return toContractorResource(requireOwnedContractor(updated));
  } catch (error) {
    mapContractorWriteError(error);
  }
}

async function ownedContractorId(database: Database, ownerUserId: string, contractorId: string) {
  const [existing] = await database.select({ id: contractors.id }).from(contractors).where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId))).limit(1);
  return requireOwnedContractor(existing).id;
}

export async function archiveContractor(database: Database, ownerUserId: string, contractorId: string) {
  const ownedId = await ownedContractorId(database, ownerUserId, contractorId);
  const updatedAt = now();
  const [, updatedRows] = await database.batch([
    database.update(assignments).set({ active: false, updatedAt }).where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, ownedId))),
    database.update(contractors).set({ active: false, updatedAt }).where(and(eq(contractors.id, ownedId), eq(contractors.ownerUserId, ownerUserId))).returning(),
  ]);
  return toContractorResource(requireOwnedContractor(updatedRows[0]));
}

export async function restoreContractor(database: Database, ownerUserId: string, contractorId: string) {
  const ownedId = await ownedContractorId(database, ownerUserId, contractorId);
  const updatedAt = now();
  const [updatedRows] = await database.batch([
    database.update(contractors).set({ active: true, updatedAt }).where(and(eq(contractors.id, ownedId), eq(contractors.ownerUserId, ownerUserId))).returning(),
    database.update(assignments).set({ active: true, updatedAt }).where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, ownedId))),
  ]);
  return toContractorResource(requireOwnedContractor(updatedRows[0]));
}

export async function createAssignment(database: Database, ownerUserId: string, input: AssignmentInput) {
  return runCreateAssignment(assignmentRepo(database), ownerUserId, input, assignmentClock);
}

export async function listAssignments(database: Database, ownerUserId: string) {
  return runListAssignments(assignmentRepo(database), ownerUserId);
}

export async function getAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runGetAssignment(assignmentRepo(database), ownerUserId, assignmentId);
}

export async function updateAssignmentRate(database: Database, ownerUserId: string, assignmentId: string, input: AssignmentRateInput) {
  return runUpdateAssignmentRate(assignmentRepo(database), ownerUserId, assignmentId, input.rateCents, assignmentClock);
}

export async function unassignAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runUnassignAssignment(assignmentRepo(database), ownerUserId, assignmentId, assignmentClock);
}

export async function restoreAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runRestoreAssignment(assignmentRepo(database), ownerUserId, assignmentId, assignmentClock);
}

export async function createTimeEntry(database: Database, ownerUserId: string, input: TimeEntryInput) {
  // Validate paid duration before any assignment write so invalid_shift cannot restore a pair.
  const clock = clockFieldsForWrite(input);
  await assertWeekUnlocked(database, ownerUserId, input.workDate);

  await applyInlineAssignSiteAfterPrecheck(assignmentRepo(database), ownerUserId, input, assignmentClock, async () => {
    const [duplicate] = await database
      .select({ id: timeEntries.id })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.ownerUserId, ownerUserId),
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
    .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true)))
    .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true)))
    .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, input.contractorId), eq(assignments.siteId, input.siteId), eq(assignments.active, true)))
    .limit(1);
  if (!match) throw new Error("not_found");

  const row = {
    id: id(),
    ownerUserId,
    contractorId: input.contractorId,
    siteId: input.siteId,
    workDate: input.workDate,
    notes: input.notes,
    ...clock,
    rateCents: match.assignmentRate ?? match.defaultRate,
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
  const [row] = await database.select({
    id: timeEntries.id, contractorId: timeEntries.contractorId, contractorName: contractors.name,
    siteId: timeEntries.siteId, siteName: sites.name, workDate: timeEntries.workDate,
    startMinutes: timeEntries.startMinutes, endMinutes: timeEntries.endMinutes,
    breakMinutes: timeEntries.breakMinutes, paidMinutes: timeEntries.paidMinutes,
    rateCents: timeEntries.rateCents, notes: timeEntries.notes, entryMode: timeEntries.entryMode,
  }).from(timeEntries)
    .innerJoin(contractors, and(eq(contractors.id, timeEntries.contractorId), eq(contractors.ownerUserId, ownerUserId)))
    .innerJoin(sites, and(eq(sites.id, timeEntries.siteId), eq(sites.ownerUserId, ownerUserId)))
    .where(and(eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.id, entryId)))
    .limit(1);
  return row ?? null;
}

export async function updateTimeEntry(database: Database, ownerUserId: string, entryId: string, input: TimeEntryUpdateInput) {
  const [existing] = await database
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.ownerUserId, ownerUserId)))
    .limit(1);
  if (!existing) throw new Error("not_found");
  await assertWeekUnlocked(database, ownerUserId, existing.workDate);
  await assertWeekUnlocked(database, ownerUserId, input.workDate);

  const clock = clockFieldsForWrite(input);
  const resnapshot = shouldResnapshotRate(existing, input);
  let assignmentEffectiveRate: number | null | undefined;
  if (resnapshot) {
    const [match] = await database
      .select({ assignmentRate: assignments.rateCents, defaultRate: contractors.defaultRateCents })
      .from(assignments)
      .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true)))
      .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true)))
      .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, input.contractorId), eq(assignments.siteId, input.siteId), eq(assignments.active, true)))
      .limit(1);
    if (!match) throw new Error("not_found");
    assignmentEffectiveRate = match.assignmentRate ?? match.defaultRate;
  }
  const rateCents = rateCentsForUpdate({
    existingRateCents: existing.rateCents,
    resnapshot,
    assignmentEffectiveRate,
  });

  const [duplicate] = await database
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
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
        updatedAt,
      })
      .where(and(eq(timeEntries.id, entryId), eq(timeEntries.ownerUserId, ownerUserId)))
      .returning();
    const row = updated[0];
    if (!row) throw new Error("not_found");
    return row;
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_entry");
    throw error;
  }
}

export async function deleteTimeEntry(database: Database, ownerUserId: string, entryId: string): Promise<boolean> {
  const [existing] = await database
    .select({ id: timeEntries.id, workDate: timeEntries.workDate })
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.ownerUserId, ownerUserId)))
    .limit(1);
  if (!existing) return false;
  await assertWeekUnlocked(database, ownerUserId, existing.workDate);
  const deleted = await database.delete(timeEntries).where(and(eq(timeEntries.id, existing.id), eq(timeEntries.ownerUserId, ownerUserId))).returning({ id: timeEntries.id });
  return deleted.length === 1;
}

export async function getDashboard(database: Database, ownerUserId: string, weekStart: string) {
  const end = weekEnd(weekStart);
  const [siteRows, contractorRows, assignmentRows, entryRows, approval] = await Promise.all([
    database.select({ id: sites.id, name: sites.name, address: sites.address }).from(sites).where(and(eq(sites.ownerUserId, ownerUserId), eq(sites.active, true))).orderBy(asc(sites.name)),
    database.select({ id: contractors.id, name: contractors.name, email: contractors.email, phone: contractors.phone, defaultRateCents: contractors.defaultRateCents, currency: contractors.currency }).from(contractors).where(and(eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true))).orderBy(asc(contractors.name)),
    database.select({ id: assignments.id, contractorId: assignments.contractorId, siteId: assignments.siteId, rateCents: assignments.rateCents }).from(assignments)
      .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true)))
      .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true)))
      .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.active, true))),
    database.select({
      id: timeEntries.id, contractorId: timeEntries.contractorId, contractorName: contractors.name,
      siteId: timeEntries.siteId, siteName: sites.name, workDate: timeEntries.workDate,
      startMinutes: timeEntries.startMinutes, endMinutes: timeEntries.endMinutes,
      breakMinutes: timeEntries.breakMinutes, paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents, notes: timeEntries.notes, entryMode: timeEntries.entryMode,
    }).from(timeEntries)
      .innerJoin(contractors, and(eq(contractors.id, timeEntries.contractorId), eq(contractors.ownerUserId, ownerUserId)))
      .innerJoin(sites, and(eq(sites.id, timeEntries.siteId), eq(sites.ownerUserId, ownerUserId)))
      .where(and(eq(timeEntries.ownerUserId, ownerUserId), gte(timeEntries.workDate, weekStart), lte(timeEntries.workDate, end)))
      .orderBy(asc(timeEntries.workDate), asc(contractors.name)),
    getWeekApproval(database, ownerUserId, weekStart),
  ]);
  return {
    weekStart, weekEnd: end, sites: siteRows, contractors: contractorRows, assignments: assignmentRows,
    entries: entryRows,
    summary: summarizeWeek(entryRows.map((entry) => ({ contractorId: entry.contractorId, contractorName: entry.contractorName, paidMinutes: entry.paidMinutes, rateCents: entry.rateCents }))),
    approval,
  };
}
