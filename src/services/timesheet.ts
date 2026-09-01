import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, contractors, sites, timeEntries } from "@/db/schema";
import {
  contractorUpdateWriteSet,
  mapContractorWriteError,
  requireOwnedContractor,
  toContractorResource,
} from "@/lib/contractor-lifecycle";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { calculatePaidMinutes, summarizeWeek, weekEnd } from "@/lib/payroll";
import type { z } from "zod";
import type { assignmentInput, contractorInput, siteInput, timeEntryInput } from "@/lib/validation";

type Database = typeof db;
type SiteInput = z.infer<typeof siteInput>;
type ContractorInput = z.infer<typeof contractorInput>;
type AssignmentInput = z.infer<typeof assignmentInput>;
type TimeEntryInput = z.infer<typeof timeEntryInput>;

const now = () => new Date();
const id = () => crypto.randomUUID();

export async function createSite(database: Database, ownerUserId: string, input: SiteInput) {
  const row = { id: id(), ownerUserId, ...input, active: true, createdAt: now(), updatedAt: now() };
  await database.insert(sites).values(row);
  return row;
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
  const [contractor] = await database.select({ id: contractors.id }).from(contractors).where(and(eq(contractors.id, input.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true))).limit(1);
  const [site] = await database.select({ id: sites.id }).from(sites).where(and(eq(sites.id, input.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true))).limit(1);
  if (!contractor || !site) throw new Error("not_found");
  const row = { id: id(), ownerUserId, ...input, active: true, createdAt: now(), updatedAt: now() };
  await database.insert(assignments).values(row);
  return row;
}

export async function createTimeEntry(database: Database, ownerUserId: string, input: TimeEntryInput) {
  if (input.assignSite) {
    try {
      await createAssignment(database, ownerUserId, {
        contractorId: input.contractorId,
        siteId: input.siteId,
        rateCents: input.assignSite.rateCents,
      });
    } catch (error) {
      if (error instanceof Error && error.message === "not_found") throw error;
      if (!isUniqueConstraintError(error)) throw error;
    }
  }

  const paidMinutes = input.entryMode === "paid_hours"
    ? input.paidMinutes
    : calculatePaidMinutes(input.startMinutes, input.endMinutes, input.breakMinutes);
  const clock = input.entryMode === "paid_hours"
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
    ...clock,
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
    database.select({ id: assignments.id, contractorId: assignments.contractorId, siteId: assignments.siteId, rateCents: assignments.rateCents }).from(assignments).innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true))).where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.active, true))),
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
