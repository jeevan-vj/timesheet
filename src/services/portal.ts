import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  dateIsoWeekday,
  eachDate,
  tasksForShifts,
  upcomingRange,
  weekdayMatchesMask,
  type PortalPaymentDetail,
  type PortalPayments,
  type PortalShift,
  type PortalUpcoming,
  type PortalWeek,
} from "@cleantrack/core/portal";
import type { db } from "@/db/client";
import { assignmentScheduleVersions, assignments, business, contractorAccount, contractors, sites, timeEntries, user, weekApprovals } from "@/db/schema";
import { calculateEntryPayCents, weekEnd, weekStartFromDate } from "@/lib/payroll";

type Database = typeof db;

type Scope = {
  contractorId: string;
  contractorName: string;
  ownerUserId: string;
  ownerName: string;
  ownerEmail: string;
  businessId: string;
  businessName: string;
};

type EntryRow = {
  id: string;
  siteId: string;
  siteName: string;
  address: string;
  workDate: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  paidMinutes: number;
  rateCents: number;
  entryMode: "clock" | "paid_hours" | "absent";
  occurrenceKind: "manual" | "scheduled" | "worked" | "absent" | "hours_override";
};

type VersionRow = {
  id: string;
  siteId: string;
  siteName: string;
  address: string;
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  assignmentActive: boolean;
  siteActive: boolean;
  rateCents: number | null;
  defaultRateCents: number;
};

type PrivateShift = PortalShift & {
  payCents: number;
  estimated: boolean;
  scopeKey: string;
};

const PORTAL_STATUSES = ["invited", "active"] as const;

function scopeKey(scope: Scope): string {
  return `${scope.ownerUserId}:${scope.businessId}`;
}

function compareShifts(a: PortalShift, b: PortalShift): number {
  if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
  const aStart = a.startMinutes ?? 24 * 60;
  const bStart = b.startMinutes ?? 24 * 60;
  if (aStart !== bStart) return aStart - bStart;
  const site = a.siteName.localeCompare(b.siteName);
  if (site !== 0) return site;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toPublic(shift: PrivateShift): PortalShift {
  return {
    id: shift.id,
    businessId: shift.businessId,
    businessName: shift.businessName,
    siteName: shift.siteName,
    address: shift.address,
    workDate: shift.workDate,
    paidMinutes: shift.paidMinutes,
    entryMode: shift.entryMode,
    occurrenceKind: shift.occurrenceKind,
    startMinutes: shift.startMinutes,
    endMinutes: shift.endMinutes,
    breakMinutes: shift.breakMinutes,
  };
}

function entryPayCents(paidMinutes: number, rateCents: number): number {
  if (paidMinutes <= 0) return 0;
  if (!Number.isInteger(rateCents) || rateCents <= 0) return 0;
  return calculateEntryPayCents(paidMinutes, rateCents);
}

function presentEntry(scope: Scope, entry: EntryRow): PrivateShift {
  const clock = entry.entryMode === "clock";
  return {
    id: entry.id,
    businessId: scope.businessId,
    businessName: scope.businessName,
    siteName: entry.siteName,
    address: entry.address,
    workDate: entry.workDate,
    paidMinutes: entry.paidMinutes,
    entryMode: entry.entryMode,
    occurrenceKind: entry.occurrenceKind,
    startMinutes: clock ? entry.startMinutes : null,
    endMinutes: clock ? entry.endMinutes : null,
    breakMinutes: clock ? entry.breakMinutes : null,
    payCents: entryPayCents(entry.paidMinutes, entry.rateCents),
    estimated: false,
    scopeKey: scopeKey(scope),
  };
}

function presentVirtual(scope: Scope, version: VersionRow, workDate: string): PrivateShift {
  const rate = version.rateCents ?? version.defaultRateCents;
  return {
    id: `sched_${version.id}_${workDate}`,
    businessId: scope.businessId,
    businessName: scope.businessName,
    siteName: version.siteName,
    address: version.address,
    workDate,
    paidMinutes: version.paidMinutes,
    entryMode: "paid_hours",
    occurrenceKind: "scheduled",
    startMinutes: null,
    endMinutes: null,
    breakMinutes: null,
    payCents: entryPayCents(version.paidMinutes, rate),
    estimated: true,
    scopeKey: scopeKey(scope),
  };
}

function versionCovers(version: VersionRow, workDate: string): boolean {
  if (workDate < version.effectiveFrom) return false;
  if (version.effectiveTo != null && workDate > version.effectiveTo) return false;
  return weekdayMatchesMask(version.weekdaysMask, dateIsoWeekday(workDate));
}

export async function listPortalScopes(database: Database, userId: string): Promise<Scope[]> {
  return database
    .select({
      contractorId: contractorAccount.contractorId,
      contractorName: contractors.name,
      ownerUserId: contractorAccount.ownerUserId,
      ownerName: user.name,
      ownerEmail: user.email,
      businessId: contractorAccount.businessId,
      businessName: business.name,
    })
    .from(contractorAccount)
    .innerJoin(business, eq(business.id, contractorAccount.businessId))
    .innerJoin(user, eq(user.id, contractorAccount.ownerUserId))
    .innerJoin(contractors, and(
      eq(contractors.id, contractorAccount.contractorId),
      eq(contractors.ownerUserId, contractorAccount.ownerUserId),
      eq(contractors.businessId, contractorAccount.businessId),
    ))
    .where(and(
      eq(contractorAccount.userId, userId),
      eq(contractorAccount.active, 1),
      inArray(contractors.engagementStatus, [...PORTAL_STATUSES]),
    ))
    .orderBy(asc(business.name), asc(contractorAccount.contractorId));
}

async function loadEntries(database: Database, scope: Scope, from: string | null, to: string | null): Promise<EntryRow[]> {
  const filters = [
    eq(timeEntries.ownerUserId, scope.ownerUserId),
    eq(timeEntries.businessId, scope.businessId),
    eq(timeEntries.contractorId, scope.contractorId),
  ];
  if (from) filters.push(gte(timeEntries.workDate, from));
  if (to) filters.push(lte(timeEntries.workDate, to));
  return database
    .select({
      id: timeEntries.id,
      siteId: timeEntries.siteId,
      siteName: sites.name,
      address: sites.address,
      workDate: timeEntries.workDate,
      startMinutes: timeEntries.startMinutes,
      endMinutes: timeEntries.endMinutes,
      breakMinutes: timeEntries.breakMinutes,
      paidMinutes: timeEntries.paidMinutes,
      rateCents: timeEntries.rateCents,
      entryMode: timeEntries.entryMode,
      occurrenceKind: timeEntries.occurrenceKind,
    })
    .from(timeEntries)
    .innerJoin(sites, and(
      eq(sites.id, timeEntries.siteId),
      eq(sites.ownerUserId, scope.ownerUserId),
      eq(sites.businessId, scope.businessId),
    ))
    .innerJoin(contractors, and(
      eq(contractors.id, timeEntries.contractorId),
      eq(contractors.id, scope.contractorId),
      eq(contractors.ownerUserId, scope.ownerUserId),
      eq(contractors.businessId, scope.businessId),
    ))
    .where(and(...filters))
    .orderBy(asc(timeEntries.workDate), asc(sites.name), asc(timeEntries.id));
}

async function loadVersions(database: Database, scope: Scope): Promise<VersionRow[]> {
  return database
    .select({
      id: assignmentScheduleVersions.id,
      siteId: assignments.siteId,
      siteName: sites.name,
      address: sites.address,
      weekdaysMask: assignmentScheduleVersions.weekdaysMask,
      paidMinutes: assignmentScheduleVersions.paidMinutes,
      effectiveFrom: assignmentScheduleVersions.effectiveFrom,
      effectiveTo: assignmentScheduleVersions.effectiveTo,
      assignmentActive: assignments.active,
      siteActive: sites.active,
      rateCents: assignments.rateCents,
      defaultRateCents: contractors.defaultRateCents,
    })
    .from(assignmentScheduleVersions)
    .innerJoin(assignments, and(
      eq(assignments.id, assignmentScheduleVersions.assignmentId),
      eq(assignments.ownerUserId, scope.ownerUserId),
      eq(assignments.businessId, scope.businessId),
      eq(assignments.contractorId, scope.contractorId),
    ))
    .innerJoin(sites, and(
      eq(sites.id, assignments.siteId),
      eq(sites.ownerUserId, scope.ownerUserId),
      eq(sites.businessId, scope.businessId),
    ))
    .innerJoin(contractors, and(
      eq(contractors.id, assignments.contractorId),
      eq(contractors.id, scope.contractorId),
      eq(contractors.ownerUserId, scope.ownerUserId),
      eq(contractors.businessId, scope.businessId),
    ))
    .where(and(
      eq(assignmentScheduleVersions.ownerUserId, scope.ownerUserId),
      eq(assignmentScheduleVersions.businessId, scope.businessId),
    ));
}

async function approvedWeekStarts(database: Database, scope: Scope): Promise<Set<string>> {
  const rows = await database
    .select({ weekStart: weekApprovals.weekStart })
    .from(weekApprovals)
    .where(and(
      eq(weekApprovals.ownerUserId, scope.ownerUserId),
      eq(weekApprovals.businessId, scope.businessId),
      eq(weekApprovals.status, "approved"),
    ));
  return new Set(rows.map((row) => row.weekStart));
}

async function shiftsForRange(database: Database, scopes: Scope[], from: string, to: string): Promise<PrivateShift[]> {
  const shifts: PrivateShift[] = [];
  for (const scope of scopes) {
    const entries = await loadEntries(database, scope, from, to);
    const covered = new Set(entries.map((entry) => `${entry.siteId}:${entry.workDate}`));
    for (const entry of entries) shifts.push(presentEntry(scope, entry));
    const versions = (await loadVersions(database, scope)).filter((version) => version.assignmentActive && version.siteActive);
    const bySite = new Map<string, VersionRow[]>();
    for (const version of versions) {
      const list = bySite.get(version.siteId) ?? [];
      list.push(version);
      bySite.set(version.siteId, list);
    }
    for (const workDate of eachDate(from, to)) {
      for (const [siteId, list] of bySite) {
        if (covered.has(`${siteId}:${workDate}`)) continue;
        const match = list
          .filter((version) => versionCovers(version, workDate))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || b.id.localeCompare(a.id))[0];
        if (!match) continue;
        shifts.push(presentVirtual(scope, match, workDate));
      }
    }
  }
  shifts.sort(compareShifts);
  return shifts;
}

function groupDays(shifts: PrivateShift[]): PortalUpcoming["days"] {
  const dates = [...new Set(shifts.map((shift) => shift.workDate))];
  return dates.map((date) => ({
    date,
    shifts: shifts.filter((shift) => shift.workDate === date).map(toPublic),
  }));
}

export async function getPortalWeek(database: Database, userId: string, weekStart: string): Promise<PortalWeek> {
  const end = weekEnd(weekStart);
  const shifts = await shiftsForRange(database, await listPortalScopes(database, userId), weekStart, end);
  return {
    weekStart,
    weekEnd: end,
    days: eachDate(weekStart, end).map((date) => ({
      date,
      shifts: shifts.filter((shift) => shift.workDate === date).map(toPublic),
    })),
    tasks: tasksForShifts(shifts),
  };
}

export async function getPortalUpcoming(database: Database, userId: string, days: number, today: string): Promise<PortalUpcoming> {
  const range = upcomingRange(today, days);
  const shifts = await shiftsForRange(database, await listPortalScopes(database, userId), range.from, range.to);
  return { from: range.from, to: range.to, days: groupDays(shifts) };
}

export async function getPortalPayments(database: Database, userId: string, weekStart: string): Promise<PortalPayments> {
  const scopes = await listPortalScopes(database, userId);
  const approved = new Map<string, Set<string>>();
  for (const scope of scopes) approved.set(scopeKey(scope), await approvedWeekStarts(database, scope));
  const headlineShifts = await shiftsForRange(database, scopes, weekStart, weekEnd(weekStart));
  let paidMinutes = 0;
  let payCents = 0;
  let estimated = false;
  for (const shift of headlineShifts) {
    const weekApproved = approved.get(shift.scopeKey)?.has(weekStart) ?? false;
    if (weekApproved && shift.estimated) continue;
    paidMinutes += shift.paidMinutes;
    payCents += shift.payCents;
    if (!weekApproved) estimated = true;
  }
  const buckets = new Map<string, { paidMinutes: number; payCents: number }>();
  for (const scope of scopes) {
    const weeks = approved.get(scopeKey(scope)) ?? new Set<string>();
    if (weeks.size === 0) continue;
    for (const entry of await loadEntries(database, scope, null, null)) {
      const start = weekStartFromDate(entry.workDate);
      if (!weeks.has(start)) continue;
      const bucket = buckets.get(start) ?? { paidMinutes: 0, payCents: 0 };
      bucket.paidMinutes += entry.paidMinutes;
      bucket.payCents += entryPayCents(entry.paidMinutes, entry.rateCents);
      buckets.set(start, bucket);
    }
  }
  const weeks = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([start, bucket]) => ({
      weekStart: start,
      weekEnd: weekEnd(start),
      paidMinutes: bucket.paidMinutes,
      payCents: bucket.payCents,
    }));
  return {
    headline: { weekStart, weekEnd: weekEnd(weekStart), paidMinutes, payCents, estimated },
    weeks,
  };
}

export async function getPortalPaymentDetail(database: Database, userId: string, weekStart: string): Promise<PortalPaymentDetail | null> {
  const scopes = await listPortalScopes(database, userId);
  const end = weekEnd(weekStart);
  const lines: PortalPaymentDetail["lines"] = [];
  let paidMinutes = 0;
  let payCents = 0;
  let found = false;
  const remittanceCandidates: PortalPaymentDetail["remittances"] = [];
  for (const scope of scopes) {
    const weeks = await approvedWeekStarts(database, scope);
    if (!weeks.has(weekStart)) continue;
    const entries = await loadEntries(database, scope, weekStart, end);
    if (entries.length > 0) {
      remittanceCandidates.push({ businessId: scope.businessId, businessName: scope.businessName });
    }
    for (const entry of entries) {
      found = true;
      const linePay = entryPayCents(entry.paidMinutes, entry.rateCents);
      paidMinutes += entry.paidMinutes;
      payCents += linePay;
      if (entry.paidMinutes <= 0) continue;
      lines.push({
        id: entry.id,
        businessId: scope.businessId,
        workDate: entry.workDate,
        siteName: entry.siteName,
        businessName: scope.businessName,
        paidMinutes: entry.paidMinutes,
        payCents: linePay,
      });
    }
  }
  if (!found) return null;
  lines.sort((a, b) => a.workDate.localeCompare(b.workDate) || a.siteName.localeCompare(b.siteName) || a.id.localeCompare(b.id));
  const businessCounts = new Map<string, number>();
  for (const target of remittanceCandidates) {
    businessCounts.set(target.businessId, (businessCounts.get(target.businessId) ?? 0) + 1);
  }
  const remittances = remittanceCandidates
    .filter((target) => businessCounts.get(target.businessId) === 1)
    .sort((a, b) => a.businessName.localeCompare(b.businessName) || a.businessId.localeCompare(b.businessId));
  return { weekStart, weekEnd: end, paidMinutes, payCents, lines, remittances };
}

export async function getPortalWeekRemittance(database: Database, userId: string, businessId: string, weekStart: string) {
  const matching = (await listPortalScopes(database, userId)).filter((scope) => scope.businessId === businessId);
  if (matching.length !== 1) throw new Error("not_found");
  const [scope] = matching;
  if (!scope || !(await approvedWeekStarts(database, scope)).has(weekStart)) throw new Error("not_found");
  const end = weekEnd(weekStart);
  const entries = await loadEntries(database, scope, weekStart, end);
  if (entries.length === 0) throw new Error("no_entries");
  return {
    contractorId: scope.contractorId,
    contractorName: scope.contractorName,
    weekStart,
    weekEnd: end,
    remitterName: scope.ownerName,
    remitterEmail: scope.ownerEmail,
    entries: entries.map((entry) => ({
      id: entry.id,
      workDate: entry.workDate,
      siteName: entry.siteName,
      paidMinutes: entry.paidMinutes,
      rateCents: entry.rateCents,
      contractorId: scope.contractorId,
      contractorName: scope.contractorName,
    })),
  };
}
