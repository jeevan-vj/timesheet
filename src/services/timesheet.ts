import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, contractors, sites, timeEntries } from "@/db/schema";
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
  const row = { id: id(), ownerUserId, ...input, currency: "NZD", active: true, createdAt: now(), updatedAt: now() };
  await database.insert(contractors).values(row);
  return row;
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
  const paidMinutes = calculatePaidMinutes(input.startMinutes, input.endMinutes, input.breakMinutes);
  const [match] = await database
    .select({ assignmentRate: assignments.rateCents, defaultRate: contractors.defaultRateCents })
    .from(assignments)
    .innerJoin(contractors, and(eq(contractors.id, assignments.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.active, true)))
    .innerJoin(sites, and(eq(sites.id, assignments.siteId), eq(sites.ownerUserId, ownerUserId), eq(sites.active, true)))
    .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.contractorId, input.contractorId), eq(assignments.siteId, input.siteId), eq(assignments.active, true)))
    .limit(1);
  if (!match) throw new Error("not_found");
  const row = {
    id: id(), ownerUserId, ...input, paidMinutes,
    rateCents: match.assignmentRate ?? match.defaultRate,
    createdAt: now(), updatedAt: now(),
  };
  await database.insert(timeEntries).values(row);
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
    database.select({ id: assignments.id, contractorId: assignments.contractorId, siteId: assignments.siteId, rateCents: assignments.rateCents }).from(assignments).where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.active, true))),
    database.select({
      id: timeEntries.id, contractorId: timeEntries.contractorId, contractorName: contractors.name,
      siteId: timeEntries.siteId, siteName: sites.name, workDate: timeEntries.workDate,
      startMinutes: timeEntries.startMinutes, endMinutes: timeEntries.endMinutes,
      breakMinutes: timeEntries.breakMinutes, paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents, notes: timeEntries.notes,
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
