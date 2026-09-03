import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { contractors, sites, timeEntries } from "@/db/schema";
import { weekEnd } from "@/lib/payroll";

type Database = typeof db;

export async function getContractorWeekRemittance(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  weekStart: string,
) {
  const end = weekEnd(weekStart);
  const [contractor] = await database
    .select({ id: contractors.id, name: contractors.name })
    .from(contractors)
    .where(and(eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId)))
    .limit(1);
  if (!contractor) throw new Error("not_found");

  const entries = await database
    .select({
      id: timeEntries.id,
      workDate: timeEntries.workDate,
      siteName: sites.name,
      paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents,
      contractorId: timeEntries.contractorId,
      contractorName: contractors.name,
    })
    .from(timeEntries)
    .innerJoin(contractors, and(eq(contractors.id, timeEntries.contractorId), eq(contractors.ownerUserId, ownerUserId)))
    .innerJoin(sites, and(eq(sites.id, timeEntries.siteId), eq(sites.ownerUserId, ownerUserId)))
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.contractorId, contractorId),
      gte(timeEntries.workDate, weekStart),
      lte(timeEntries.workDate, end),
    ))
    .orderBy(asc(timeEntries.workDate), asc(sites.name), asc(timeEntries.id));

  if (entries.length === 0) throw new Error("no_entries");
  return { contractor, weekStart, weekEnd: end, entries };
}
