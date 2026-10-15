import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { contractors, sites, timeEntries } from "@/db/schema";
import { ownerBusinessIdOrNull } from "@/lib/business";
import { weekEnd } from "@/lib/payroll";

type Database = typeof db;

export async function getContractorWeekRemittance(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  weekStart: string,
) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) throw new Error("not_found");
  const end = weekEnd(weekStart);
  const [contractor] = await database
    .select({ id: contractors.id, name: contractors.name })
    .from(contractors)
    .where(and(
      eq(contractors.id, contractorId),
      eq(contractors.ownerUserId, ownerUserId),
      eq(contractors.businessId, businessId),
    ))
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
      eq(timeEntries.contractorId, contractorId),
      gte(timeEntries.workDate, weekStart),
      lte(timeEntries.workDate, end),
    ))
    .orderBy(asc(timeEntries.workDate), asc(sites.name), asc(timeEntries.id));

  if (entries.length === 0) throw new Error("no_entries");
  return { contractor, weekStart, weekEnd: end, entries };
}
