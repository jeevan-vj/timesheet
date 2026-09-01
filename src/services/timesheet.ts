import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { assignments, contractors, sites, timeEntries } from "@/db/schema";
import {
  applyInlineAssignSite,
  runCreateAssignment,
  runGetAssignment,
  runListAssignments,
  runRestoreAssignment,
  runUnassignAssignment,
  runUpdateAssignmentRate,
  type AssignmentPatch,
  type AssignmentRecord,
  type AssignmentRepository,
  type JoinedAssignment,
} from "@/lib/assignment";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { calculatePaidMinutes, summarizeWeek, weekEnd } from "@/lib/payroll";
import type { z } from "zod";
import type { assignmentInput, assignmentRateInput, contractorInput, siteInput, timeEntryInput } from "@/lib/validation";

type Database = typeof db;
type SiteInput = z.infer<typeof siteInput>;
type ContractorInput = z.infer<typeof contractorInput>;
type AssignmentInput = z.infer<typeof assignmentInput>;
type AssignmentRateInput = z.infer<typeof assignmentRateInput>;
type TimeEntryInput = z.infer<typeof timeEntryInput>;

const now = () => new Date();
const id = () => crypto.randomUUID();
const clock = { id, now };

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
      const [row] = await database.select().from(assignments).where(and(
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.contractorId, contractorId),
        eq(assignments.siteId, siteId),
      )).limit(1);
      return row as AssignmentRecord | undefined;
    },
    async getAssignmentById(ownerUserId, assignmentId) {
      const [row] = await database.select().from(assignments).where(and(
        eq(assignments.id, assignmentId),
        eq(assignments.ownerUserId, ownerUserId),
      )).limit(1);
      return row as AssignmentRecord | undefined;
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

export async function createSite(database: Database, ownerUserId: string, input: SiteInput) {
  const row = { id: id(), ownerUserId, ...input, active: true, createdAt: now(), updatedAt: now() };
  await database.insert(sites).values(row);
  return row;
}

export async function createContractor(database: Database, ownerUserId: string, input: ContractorInput) {
  const row = { id: id(), ownerUserId, ...input, currency: "NZD", active: true, createdAt: now(), updatedAt: now() };
  await database.insert(contractors).values(row);
  return row;
}

export async function createAssignment(database: Database, ownerUserId: string, input: AssignmentInput) {
  return runCreateAssignment(assignmentRepo(database), ownerUserId, input, clock);
}

export async function listAssignments(database: Database, ownerUserId: string) {
  return runListAssignments(assignmentRepo(database), ownerUserId);
}

export async function getAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runGetAssignment(assignmentRepo(database), ownerUserId, assignmentId);
}

export async function updateAssignmentRate(database: Database, ownerUserId: string, assignmentId: string, input: AssignmentRateInput) {
  return runUpdateAssignmentRate(assignmentRepo(database), ownerUserId, assignmentId, input.rateCents, clock);
}

export async function unassignAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runUnassignAssignment(assignmentRepo(database), ownerUserId, assignmentId, clock);
}

export async function restoreAssignment(database: Database, ownerUserId: string, assignmentId: string) {
  return runRestoreAssignment(assignmentRepo(database), ownerUserId, assignmentId, clock);
}

export async function createTimeEntry(database: Database, ownerUserId: string, input: TimeEntryInput) {
  await applyInlineAssignSite(assignmentRepo(database), ownerUserId, input, clock);

  const paidMinutes = input.entryMode === "paid_hours"
    ? input.paidMinutes
    : calculatePaidMinutes(input.startMinutes, input.endMinutes, input.breakMinutes);
  const shiftClock = input.entryMode === "paid_hours"
    ? { startMinutes: 0, endMinutes: paidMinutes, breakMinutes: 0 }
    : { startMinutes: input.startMinutes, endMinutes: input.endMinutes, breakMinutes: input.breakMinutes };

  const [match] = await database
    .select({ assignmentRate: assignments.rateCents, defaultRate: contractors.defaultRateCents })
    .from(assignments)
    .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true)))
    .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true)))
    .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, input.contractorId), eq(assignments.siteId, input.siteId), eq(assignments.active, true)))
    .limit(1);
  if (!match) throw new Error("not_found");

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

  const row = {
    id: id(),
    ownerUserId,
    contractorId: input.contractorId,
    siteId: input.siteId,
    workDate: input.workDate,
    notes: input.notes,
    ...shiftClock,
    paidMinutes,
    entryMode: input.entryMode,
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

export async function deleteTimeEntry(database: Database, ownerUserId: string, entryId: string): Promise<boolean> {
  const deleted = await database.delete(timeEntries).where(and(eq(timeEntries.id, entryId), eq(timeEntries.ownerUserId, ownerUserId))).returning({ id: timeEntries.id });
  return deleted.length === 1;
}

export async function getDashboard(database: Database, ownerUserId: string, weekStart: string) {
  const end = weekEnd(weekStart);
  const [siteRows, contractorRows, assignmentRows, entryRows] = await Promise.all([
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
  ]);
  return {
    weekStart, weekEnd: end, sites: siteRows, contractors: contractorRows, assignments: assignmentRows,
    entries: entryRows,
    summary: summarizeWeek(entryRows.map((entry) => ({ contractorId: entry.contractorId, contractorName: entry.contractorName, paidMinutes: entry.paidMinutes, rateCents: entry.rateCents }))),
  };
}
