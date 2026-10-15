import { and, eq, gte, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { timeEntries, weekApprovals } from "@/db/schema";
import { requireOwnerBusinessId } from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { weekEnd, weekPayrollTotals, weekStartFromDate } from "@/lib/payroll";
import { findWeekApproval } from "@/lib/week-approval-query";

type Database = typeof db;

export type WeekApprovalResource = {
  id: string;
  weekStart: string;
  status: "approved" | "reopened";
  approvedAt: string;
  reopenedAt: string | null;
};

export type DashboardApproval = {
  status: "open" | "approved" | "reopened";
  approvedAt: string | null;
  reopenedAt: string | null;
};

const now = () => new Date(Math.floor(Date.now() / 1000) * 1000);
const id = () => crypto.randomUUID();

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toWeekApprovalResource(row: {
  id: string;
  weekStart: string;
  status: "approved" | "reopened";
  approvedAt: Date;
  reopenedAt: Date | null;
}): WeekApprovalResource {
  return {
    id: row.id,
    weekStart: row.weekStart,
    status: row.status,
    approvedAt: row.approvedAt.toISOString(),
    reopenedAt: toIso(row.reopenedAt),
  };
}

export function toDashboardApproval(
  row: { status: "approved" | "reopened"; approvedAt: Date; reopenedAt: Date | null } | null,
): DashboardApproval {
  if (!row) return { status: "open", approvedAt: null, reopenedAt: null };
  if (row.status === "approved") {
    return { status: "approved", approvedAt: row.approvedAt.toISOString(), reopenedAt: null };
  }
  return { status: "reopened", approvedAt: row.approvedAt.toISOString(), reopenedAt: toIso(row.reopenedAt) };
}

async function currentWeekTotals(database: Database, ownerUserId: string, businessId: string, weekStart: string) {
  const end = weekEnd(weekStart);
  const entries = await database
    .select({
      paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents,
    })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
      gte(timeEntries.workDate, weekStart),
      lte(timeEntries.workDate, end),
    ));
  return weekPayrollTotals(entries);
}

export async function assertUnlockedWeek(database: Database, ownerUserId: string, workDate: string, businessId: string) {
  const weekStart = weekStartFromDate(workDate);
  const existing = await findWeekApproval(database, ownerUserId, weekStart, businessId);
  if (existing?.status === "approved") throw new Error("week_locked");
}

export async function approveWeek(
  database: Database,
  ownerUserId: string,
  input: { weekStart: string; expectedPaidMinutes: number; expectedPayCents: number },
): Promise<WeekApprovalResource> {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const totals = await currentWeekTotals(database, ownerUserId, businessId, input.weekStart);
  if (totals.currentPaidMinutes !== input.expectedPaidMinutes || totals.currentPayCents !== input.expectedPayCents) {
    throw new Error("stale_week");
  }

  const existing = await findWeekApproval(database, ownerUserId, input.weekStart, businessId);
  if (existing?.status === "approved") return toWeekApprovalResource(existing);

  const approvedAt = now();
  if (existing?.status === "reopened") {
    const [updated] = await database
      .update(weekApprovals)
      .set({ status: "approved", approvedAt, reopenedAt: null, updatedAt: approvedAt })
      .where(and(
        eq(weekApprovals.ownerUserId, ownerUserId),
        eq(weekApprovals.businessId, businessId),
        eq(weekApprovals.weekStart, input.weekStart),
      ))
      .returning();
    if (!updated) throw new Error("stale_week");
    return toWeekApprovalResource(updated);
  }

  const row = {
    id: id(),
    ownerUserId,
    businessId,
    weekStart: input.weekStart,
    status: "approved" as const,
    approvedAt,
    reopenedAt: null,
    createdAt: approvedAt,
    updatedAt: approvedAt,
  };
  try {
    const [inserted] = await database.insert(weekApprovals).values(row).returning();
    return toWeekApprovalResource(inserted ?? row);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await findWeekApproval(database, ownerUserId, input.weekStart, businessId);
    if (raced?.status === "approved") {
      const again = await currentWeekTotals(database, ownerUserId, businessId, input.weekStart);
      if (again.currentPaidMinutes === input.expectedPaidMinutes && again.currentPayCents === input.expectedPayCents) {
        return toWeekApprovalResource(raced);
      }
    }
    throw error;
  }
}

export async function reopenWeek(
  database: Database,
  ownerUserId: string,
  input: { weekStart: string },
): Promise<WeekApprovalResource> {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const existing = await findWeekApproval(database, ownerUserId, input.weekStart, businessId);
  if (!existing) throw new Error("week_not_approved");
  if (existing.status === "reopened") return toWeekApprovalResource(existing);

  const reopenedAt = now();
  const [updated] = await database
    .update(weekApprovals)
    .set({ status: "reopened", reopenedAt, updatedAt: reopenedAt })
    .where(and(
      eq(weekApprovals.ownerUserId, ownerUserId),
      eq(weekApprovals.businessId, businessId),
      eq(weekApprovals.weekStart, input.weekStart),
    ))
    .returning();
  if (!updated) throw new Error("week_not_approved");
  return toWeekApprovalResource(updated);
}
