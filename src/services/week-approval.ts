import { and, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { timeEntries, weekApprovals } from "@/db/schema";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { weekEnd, weekStartForDate, weekTotals } from "@/lib/payroll";

type Database = typeof db;

export type WeekApprovalResource = {
  status: "open" | "approved";
  approvedAt: string | null;
  reopenedAt: string | null;
};

type WeekTotalsExpectation = {
  expectedPaidMinutes: number;
  expectedPayCents: number;
};

const now = () => new Date();
const id = () => crypto.randomUUID();

const neverApproved: WeekApprovalResource = { status: "open", approvedAt: null, reopenedAt: null };

function isoTimestamp(value: Date | number | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(typeof value === "number" && value < 1e12 ? value * 1000 : value);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toApprovalResource(row: { status: "open" | "approved"; approvedAt: Date | null; reopenedAt: Date | null } | undefined): WeekApprovalResource {
  if (!row) return neverApproved;
  return {
    status: row.status,
    approvedAt: isoTimestamp(row.approvedAt),
    reopenedAt: isoTimestamp(row.reopenedAt),
  };
}

async function ownedWeekApproval(database: Database, ownerUserId: string, weekStart: string) {
  const [row] = await database
    .select({
      id: weekApprovals.id,
      status: weekApprovals.status,
      approvedAt: weekApprovals.approvedAt,
      reopenedAt: weekApprovals.reopenedAt,
    })
    .from(weekApprovals)
    .where(and(eq(weekApprovals.ownerUserId, ownerUserId), eq(weekApprovals.weekStart, weekStart)))
    .limit(1);
  return row;
}

async function currentWeekTotals(database: Database, ownerUserId: string, weekStart: string) {
  const end = weekEnd(weekStart);
  const entries = await database
    .select({ paidMinutes: timeEntries.paidMinutes, rateCents: timeEntries.rateCents })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      gte(timeEntries.workDate, weekStart),
      lte(timeEntries.workDate, end),
    ));
  return weekTotals(entries);
}

function assertExpectedTotals(
  current: { paidMinutes: number; payCents: number },
  expected: WeekTotalsExpectation,
) {
  if (current.paidMinutes !== expected.expectedPaidMinutes || current.payCents !== expected.expectedPayCents) {
    throw new Error("stale_week_totals");
  }
}

export async function getWeekApproval(database: Database, ownerUserId: string, weekStart: string): Promise<WeekApprovalResource> {
  return toApprovalResource(await ownedWeekApproval(database, ownerUserId, weekStart));
}

export async function approveWeek(
  database: Database,
  ownerUserId: string,
  weekStart: string,
  expected: WeekTotalsExpectation,
): Promise<WeekApprovalResource> {
  assertExpectedTotals(await currentWeekTotals(database, ownerUserId, weekStart), expected);
  const existing = await ownedWeekApproval(database, ownerUserId, weekStart);
  if (existing?.status === "approved") throw new Error("week_already_approved");

  const approvedAt = now();
  if (!existing) {
    try {
      await database.insert(weekApprovals).values({
        id: id(),
        ownerUserId,
        weekStart,
        status: "approved",
        approvedAt,
        reopenedAt: null,
        createdAt: approvedAt,
        updatedAt: approvedAt,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new Error("week_already_approved");
      throw error;
    }
    return getWeekApproval(database, ownerUserId, weekStart);
  }

  await database
    .update(weekApprovals)
    .set({ status: "approved", approvedAt, updatedAt: approvedAt })
    .where(and(eq(weekApprovals.id, existing.id), eq(weekApprovals.ownerUserId, ownerUserId)));
  return getWeekApproval(database, ownerUserId, weekStart);
}

export async function reopenWeek(
  database: Database,
  ownerUserId: string,
  weekStart: string,
  expected: WeekTotalsExpectation,
): Promise<WeekApprovalResource> {
  assertExpectedTotals(await currentWeekTotals(database, ownerUserId, weekStart), expected);
  const existing = await ownedWeekApproval(database, ownerUserId, weekStart);
  if (!existing || existing.status === "open") throw new Error("week_not_approved");

  const reopenedAt = now();
  await database
    .update(weekApprovals)
    .set({ status: "open", reopenedAt, updatedAt: reopenedAt })
    .where(and(eq(weekApprovals.id, existing.id), eq(weekApprovals.ownerUserId, ownerUserId)));
  return getWeekApproval(database, ownerUserId, weekStart);
}

export async function assertWeekUnlocked(database: Database, ownerUserId: string, workDate: string): Promise<void> {
  const weekStart = weekStartForDate(workDate);
  const existing = await ownedWeekApproval(database, ownerUserId, weekStart);
  if (existing?.status === "approved") throw new Error("week_locked");
}
