import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import type { db } from "@/db/client";
import { assignmentScheduleVersions, assignments, contractors, sites, timeEntries, weekApprovals } from "@/db/schema";
import { ownerBusinessIdOrNull, requireOwnerBusinessId } from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { weekEnd, weekStartFromDate } from "@/lib/payroll";
import {
  addDaysIso,
  dateIsoWeekday,
  decodeWeekdays,
  encodeWeekdays,
  expandScheduledDates,
  midWeekGoingForward,
  planCloseAndOpenVersions,
  shouldSkipExistingEntry,
} from "@/lib/schedule";
import { clockFieldsForWrite, paidHoursClockFields } from "@/lib/time-entry-write";
import type { occurrenceExceptionInput, schedulePutInput } from "@/lib/validation";
import { findWeekApproval } from "@/lib/week-approval-query";
import { getTimeEntry } from "@/services/timesheet";
import { assertUnlockedWeek } from "@/services/week-approval";
import type { z } from "zod";

type Database = typeof db;
type SchedulePutInput = z.infer<typeof schedulePutInput>;
type OccurrenceExceptionInput = z.infer<typeof occurrenceExceptionInput>;

export type ScheduleCurrentView = {
  id: string;
  weekdays: number[];
  paidMinutes: number;
  effectiveFrom: string;
};

export type ScheduleVersionView = ScheduleCurrentView & {
  effectiveTo: string | null;
};

const now = () => new Date();
const id = () => crypto.randomUUID();

function toCurrentView(row: {
  id: string;
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
}): ScheduleCurrentView {
  return {
    id: row.id,
    weekdays: decodeWeekdays(row.weekdaysMask),
    paidMinutes: row.paidMinutes,
    effectiveFrom: row.effectiveFrom,
  };
}

function toVersionView(row: {
  id: string;
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}): ScheduleVersionView {
  return {
    ...toCurrentView(row),
    effectiveTo: row.effectiveTo,
  };
}

function uniqueWeekdays(weekdays: number[]) {
  return [...new Set(weekdays)].sort((a, b) => a - b);
}

function thisDayWouldChange(
  existing: { occurrenceKind: string; entryMode: string; paidMinutes: number; startMinutes: number; endMinutes: number; breakMinutes: number },
  next: { occurrenceKind: string; entryMode: string; paidMinutes: number; startMinutes: number; endMinutes: number; breakMinutes: number },
) {
  return existing.occurrenceKind !== next.occurrenceKind
    || existing.entryMode !== next.entryMode
    || existing.paidMinutes !== next.paidMinutes
    || existing.startMinutes !== next.startMinutes
    || existing.endMinutes !== next.endMinutes
    || existing.breakMinutes !== next.breakMinutes;
}

async function loadOwnedAssignment(database: Database, ownerUserId: string, businessId: string, assignmentId: string) {
  const [row] = await database
    .select({
      id: assignments.id,
      contractorId: assignments.contractorId,
      siteId: assignments.siteId,
      active: assignments.active,
    })
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.ownerUserId, ownerUserId), eq(assignments.businessId, businessId)))
    .limit(1);
  return row ?? null;
}

async function loadAssignmentByPair(database: Database, ownerUserId: string, businessId: string, contractorId: string, siteId: string) {
  const [row] = await database
    .select({
      id: assignments.id,
      contractorId: assignments.contractorId,
      siteId: assignments.siteId,
      active: assignments.active,
    })
    .from(assignments)
    .where(and(
      eq(assignments.ownerUserId, ownerUserId), eq(assignments.businessId, businessId),
      eq(assignments.contractorId, contractorId),
      eq(assignments.siteId, siteId),
    ))
    .limit(1);
  return row ?? null;
}

async function loadOpenVersion(database: Database, ownerUserId: string, businessId: string, assignmentId: string) {
  const rows = await database
    .select()
    .from(assignmentScheduleVersions)
    .where(and(
      eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId),
      eq(assignmentScheduleVersions.assignmentId, assignmentId),
    ));
  return rows.find((row) => row.effectiveTo == null) ?? null;
}

async function loadApprovedWeekStarts(database: Database, ownerUserId: string, businessId: string) {
  const rows = await database
    .select({
      weekStart: weekApprovals.weekStart,
      status: weekApprovals.status,
    })
    .from(weekApprovals)
    .where(and(eq(weekApprovals.ownerUserId, ownerUserId), eq(weekApprovals.businessId, businessId)));
  return new Set(rows.filter((row) => row.status === "approved").map((row) => row.weekStart));
}

async function insertOpenVersion(database: Database, ownerUserId: string, businessId: string, assignmentId: string, input: {
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
}) {
  const timestamp = now();
  const row = {
    id: id(),
    ownerUserId,
    businessId,
    assignmentId,
    weekdaysMask: input.weekdaysMask,
    paidMinutes: input.paidMinutes,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await database.insert(assignmentScheduleVersions).values(row);
  return row;
}

async function closeVersion(database: Database, ownerUserId: string, businessId: string, versionId: string, effectiveTo: string) {
  await database
    .update(assignmentScheduleVersions)
    .set({ effectiveTo, updatedAt: now() })
    .where(and(
      eq(assignmentScheduleVersions.id, versionId),
      eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId),
    ));
}

async function rewriteUnexceptedScheduled(
  database: Database,
  ownerUserId: string,
  businessId: string,
  contractorId: string,
  siteId: string,
  fromDate: string,
  newVersion: { id: string; paidMinutes: number; weekdaysMask: number },
) {
  const rows = await database
    .select({
      id: timeEntries.id,
      workDate: timeEntries.workDate,
      occurrenceKind: timeEntries.occurrenceKind,
    })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId),
      eq(timeEntries.contractorId, contractorId),
      eq(timeEntries.siteId, siteId),
      gte(timeEntries.workDate, fromDate),
    ));
  const approved = await loadApprovedWeekStarts(database, ownerUserId, businessId);
  const allowedDays = new Set(decodeWeekdays(newVersion.weekdaysMask));
  const clock = paidHoursClockFields(newVersion.paidMinutes);
  const timestamp = now();
  const deleteIds: string[] = [];
  const updateIds: string[] = [];
  for (const row of rows) {
    if (row.occurrenceKind !== "scheduled") continue;
    if (approved.has(weekStartFromDate(row.workDate))) continue;
    if (!allowedDays.has(dateIsoWeekday(row.workDate))) deleteIds.push(row.id);
    else updateIds.push(row.id);
  }
  if (deleteIds.length > 0) {
    await database.delete(timeEntries).where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
      inArray(timeEntries.id, deleteIds),
    ));
  }
  if (updateIds.length > 0) {
    await database.update(timeEntries).set({
      paidMinutes: newVersion.paidMinutes,
      ...clock,
      scheduleVersionId: newVersion.id,
      updatedAt: timestamp,
    }).where(and(
      eq(timeEntries.ownerUserId, ownerUserId),
      eq(timeEntries.businessId, businessId),
      inArray(timeEntries.id, updateIds),
    ));
  }
}

async function requireEntryResource(database: Database, ownerUserId: string, entryId: string) {
  const resource = await getTimeEntry(database, ownerUserId, entryId);
  if (!resource) throw new Error("not_found");
  return resource;
}

export async function getAssignmentSchedule(database: Database, ownerUserId: string, assignmentId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) throw new Error("not_found");
  const assignment = await loadOwnedAssignment(database, ownerUserId, businessId, assignmentId);
  if (!assignment) throw new Error("not_found");
  const rows = await database
    .select()
    .from(assignmentScheduleVersions)
    .where(and(
      eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId),
      eq(assignmentScheduleVersions.assignmentId, assignmentId),
    ))
    .orderBy(asc(assignmentScheduleVersions.effectiveFrom), asc(assignmentScheduleVersions.createdAt));
  const versions = rows.map(toVersionView);
  const open = rows.find((row) => row.effectiveTo == null) ?? null;
  return {
    current: open ? toCurrentView(open) : null,
    versions,
  };
}

export async function putAssignmentSchedule(
  database: Database,
  ownerUserId: string,
  assignmentId: string,
  input: SchedulePutInput,
) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const assignment = await loadOwnedAssignment(database, ownerUserId, businessId, assignmentId);
  if (!assignment) throw new Error("not_found");
  const open = await loadOpenVersion(database, ownerUserId, businessId, assignmentId);
  const weekdaysMask = encodeWeekdays(uniqueWeekdays(input.weekdays));

  if (input.mode === "create") {
    if (!assignment.active) throw new Error("not_found");
    if (open) throw new Error("schedule_exists");
    const created = await insertOpenVersion(database, ownerUserId, businessId, assignmentId, {
      weekdaysMask,
      paidMinutes: input.paidMinutes,
      effectiveFrom: input.fromDate ?? input.weekStart,
    });
    await applyScheduleToWeek(database, ownerUserId, input.weekStart);
    return toCurrentView(created);
  }

  if (!open) throw new Error("not_found");
  const planned = planCloseAndOpenVersions({
    currentEffectiveFrom: open.effectiveFrom,
    newEffectiveFrom: input.weekStart,
  });
  await closeVersion(database, ownerUserId, businessId, open.id, planned.closeEffectiveTo);
  const created = await insertOpenVersion(database, ownerUserId, businessId, assignmentId, {
    weekdaysMask,
    paidMinutes: input.paidMinutes,
    effectiveFrom: input.weekStart,
  });
  await rewriteUnexceptedScheduled(
    database,
    ownerUserId,
    businessId,
    assignment.contractorId,
    assignment.siteId,
    input.weekStart,
    created,
  );
  await applyScheduleToWeek(database, ownerUserId, input.weekStart);
  return toCurrentView(created);
}

export async function deleteAssignmentSchedule(
  database: Database,
  ownerUserId: string,
  assignmentId: string,
  input: { weekStart: string },
) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const assignment = await loadOwnedAssignment(database, ownerUserId, businessId, assignmentId);
  if (!assignment) throw new Error("not_found");
  const open = await loadOpenVersion(database, ownerUserId, businessId, assignmentId);
  if (!open) throw new Error("not_found");
  const planned = planCloseAndOpenVersions({
    currentEffectiveFrom: open.effectiveFrom,
    newEffectiveFrom: input.weekStart,
  });
  await closeVersion(database, ownerUserId, businessId, open.id, planned.closeEffectiveTo);
  return { ok: true as const };
}

export async function applyScheduleToWeek(database: Database, ownerUserId: string, weekStart: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const end = weekEnd(weekStart);
  const [assignmentRows, versionRows, existingRows, approval] = await Promise.all([
    database
      .select({
        id: assignments.id,
        contractorId: assignments.contractorId,
        siteId: assignments.siteId,
        assignmentRate: assignments.rateCents,
        defaultRate: contractors.defaultRateCents,
      })
      .from(assignments)
      .innerJoin(contractors, and(
        eq(contractors.id, assignments.contractorId),
        eq(contractors.ownerUserId, ownerUserId), eq(contractors.businessId, businessId),
        eq(contractors.active, true),
      ))
      .innerJoin(sites, and(
        eq(sites.id, assignments.siteId),
        eq(sites.ownerUserId, ownerUserId), eq(sites.businessId, businessId),
        eq(sites.active, true),
      ))
      .where(and(eq(assignments.ownerUserId, ownerUserId), eq(assignments.businessId, businessId), eq(assignments.active, true))),
    database
      .select()
      .from(assignmentScheduleVersions)
      .where(and(eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId))),
    database
      .select({
        id: timeEntries.id,
        contractorId: timeEntries.contractorId,
        siteId: timeEntries.siteId,
        workDate: timeEntries.workDate,
      })
      .from(timeEntries)
      .where(and(
        eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId),
        gte(timeEntries.workDate, weekStart),
        lte(timeEntries.workDate, end),
      )),
    findWeekApproval(database, ownerUserId, weekStart, businessId),
  ]);

  const openByAssignment = new Map<string, (typeof versionRows)[number]>();
  for (const version of versionRows) {
    if (version.effectiveTo != null) continue;
    openByAssignment.set(version.assignmentId, version);
  }
  const existingKeys = new Set(
    existingRows.map((row) => `${row.contractorId}\0${row.siteId}\0${row.workDate}`),
  );
  const weekLocked = approval?.status === "approved";
  let inserted = 0;
  const timestamp = now();

  for (const assignment of assignmentRows) {
    const version = openByAssignment.get(assignment.id);
    if (!version) continue;
    const dates = expandScheduledDates({
      weekStart,
      weekdaysMask: version.weekdaysMask,
      paidMinutes: version.paidMinutes,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
    });
    for (const date of dates) {
      const existing = existingKeys.has(`${assignment.contractorId}\0${assignment.siteId}\0${date.workDate}`)
        ? { id: "existing" }
        : null;
      if (shouldSkipExistingEntry(existing)) continue;
      if (weekLocked) continue;
      const clock = paidHoursClockFields(date.paidMinutes);
      const row = {
        id: id(),
        ownerUserId,
        businessId,
        contractorId: assignment.contractorId,
        siteId: assignment.siteId,
        workDate: date.workDate,
        notes: "",
        entryMode: "paid_hours" as const,
        paidMinutes: date.paidMinutes,
        ...clock,
        rateCents: assignment.assignmentRate ?? assignment.defaultRate,
        occurrenceKind: "scheduled" as const,
        scheduleVersionId: version.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      try {
        await database.insert(timeEntries).values(row);
        existingKeys.add(`${assignment.contractorId}\0${assignment.siteId}\0${date.workDate}`);
        inserted += 1;
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
  }

  return { weekStart, inserted };
}

async function applyHoursOverrideGoingForward(
  database: Database,
  ownerUserId: string,
  businessId: string,
  existing: typeof timeEntries.$inferSelect,
  paidMinutes: number,
) {
  const assignment = await loadAssignmentByPair(database, ownerUserId, businessId, existing.contractorId, existing.siteId);
  if (!assignment) throw new Error("not_found");
  const open = await loadOpenVersion(database, ownerUserId, businessId, assignment.id);
  let template = open;
  if (!template && existing.scheduleVersionId) {
    const [row] = await database
      .select()
      .from(assignmentScheduleVersions)
      .where(and(
        eq(assignmentScheduleVersions.id, existing.scheduleVersionId),
        eq(assignmentScheduleVersions.ownerUserId, ownerUserId), eq(assignmentScheduleVersions.businessId, businessId),
      ))
      .limit(1);
    template = row ?? null;
  }
  if (!template) throw new Error("no_schedule");

  const thisWeekStart = weekStartFromDate(existing.workDate);
  const approval = await findWeekApproval(database, ownerUserId, thisWeekStart, businessId);
  const thisWeekLocked = approval?.status === "approved";
  const mid = midWeekGoingForward(existing.workDate);
  let newEffectiveFrom = mid.newEffectiveFrom;
  let convertMondayToScheduled = !mid.thisDayOnly && !thisWeekLocked;
  let applyThisDayOverride = mid.thisDayOnly && !thisWeekLocked;

  if (thisWeekLocked && !mid.thisDayOnly) {
    newEffectiveFrom = addDaysIso(existing.workDate, 7);
  }
  if (thisWeekLocked) {
    convertMondayToScheduled = false;
    applyThisDayOverride = false;
  }

  if (applyThisDayOverride) {
    const next = {
      occurrenceKind: "hours_override" as const,
      ...clockFieldsForWrite({ entryMode: "paid_hours", paidMinutes }),
    };
    if (thisDayWouldChange(existing, next)) {
      await assertUnlockedWeek(database, ownerUserId, existing.workDate, businessId);
      await database
        .update(timeEntries)
        .set({ ...next, updatedAt: now() })
        .where(and(eq(timeEntries.id, existing.id), eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId)));
    }
  }

  if (open) {
    const planned = planCloseAndOpenVersions({
      currentEffectiveFrom: open.effectiveFrom,
      newEffectiveFrom,
    });
    await closeVersion(database, ownerUserId, businessId, open.id, planned.closeEffectiveTo);
  }

  const created = await insertOpenVersion(database, ownerUserId, businessId, assignment.id, {
    weekdaysMask: template.weekdaysMask,
    paidMinutes,
    effectiveFrom: newEffectiveFrom,
  });

  if (convertMondayToScheduled) {
    await database
      .update(timeEntries)
      .set({
        occurrenceKind: "scheduled",
        ...clockFieldsForWrite({ entryMode: "paid_hours", paidMinutes }),
        scheduleVersionId: created.id,
        updatedAt: now(),
      })
      .where(and(eq(timeEntries.id, existing.id), eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId)));
  }

  await rewriteUnexceptedScheduled(
    database,
    ownerUserId,
    businessId,
    existing.contractorId,
    existing.siteId,
    newEffectiveFrom,
    created,
  );

  if (convertMondayToScheduled) {
    await applyScheduleToWeek(database, ownerUserId, thisWeekStart);
  }

  return requireEntryResource(database, ownerUserId, existing.id);
}

type ThisDayOccurrence = {
  occurrenceKind: "absent" | "scheduled" | "worked" | "hours_override";
  entryMode: "absent" | "paid_hours";
  paidMinutes: number;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
};

function paidHoursOccurrence(kind: "scheduled" | "worked" | "hours_override", paidMinutes: number): ThisDayOccurrence {
  return {
    occurrenceKind: kind,
    entryMode: "paid_hours",
    paidMinutes,
    ...paidHoursClockFields(paidMinutes),
  };
}

async function scheduledVersionMinutes(
  database: Database,
  ownerUserId: string,
  businessId: string,
  scheduleVersionId: string | null,
) {
  if (!scheduleVersionId) throw new Error("no_schedule");
  const [version] = await database
    .select({ paidMinutes: assignmentScheduleVersions.paidMinutes })
    .from(assignmentScheduleVersions)
    .where(and(
      eq(assignmentScheduleVersions.id, scheduleVersionId),
      eq(assignmentScheduleVersions.ownerUserId, ownerUserId),
      eq(assignmentScheduleVersions.businessId, businessId),
    ))
    .limit(1);
  if (!version) throw new Error("not_found");
  return version.paidMinutes;
}

async function nextThisDayOccurrence(
  database: Database,
  ownerUserId: string,
  businessId: string,
  existing: { scheduleVersionId: string | null },
  input: OccurrenceExceptionInput,
): Promise<ThisDayOccurrence> {
  if (input.kind === "absent") {
    return { occurrenceKind: "absent", entryMode: "absent", paidMinutes: 0, startMinutes: 0, endMinutes: 0, breakMinutes: 0 };
  }
  if (input.kind === "hours_override") {
    if (input.paidMinutes == null) throw new Error("invalid_request");
    return paidHoursOccurrence("hours_override", input.paidMinutes);
  }
  const paidMinutes = await scheduledVersionMinutes(database, ownerUserId, businessId, existing.scheduleVersionId);
  return paidHoursOccurrence(input.kind === "confirm_worked" ? "worked" : "scheduled", paidMinutes);
}

export async function applyOccurrenceException(
  database: Database,
  ownerUserId: string,
  entryId: string,
  input: OccurrenceExceptionInput,
) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [existing] = await database
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, entryId), eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId)))
    .limit(1);
  if (!existing) throw new Error("not_found");
  if (existing.occurrenceKind === "manual") throw new Error("no_schedule");

  if (input.kind === "hours_override" && input.scope === "going_forward") {
    if (input.paidMinutes == null) throw new Error("invalid_request");
    return applyHoursOverrideGoingForward(database, ownerUserId, businessId, existing, input.paidMinutes);
  }

  const next = await nextThisDayOccurrence(database, ownerUserId, businessId, existing, input);
  if (thisDayWouldChange(existing, next)) {
    await assertUnlockedWeek(database, ownerUserId, existing.workDate, businessId);
    await database
      .update(timeEntries)
      .set({ ...next, updatedAt: now() })
      .where(and(eq(timeEntries.id, existing.id), eq(timeEntries.ownerUserId, ownerUserId), eq(timeEntries.businessId, businessId)));
  }

  return requireEntryResource(database, ownerUserId, existing.id);
}
