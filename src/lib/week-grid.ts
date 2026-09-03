import { paidMinutesFromParts } from "@/lib/payroll";
import { addDaysIso, formatWeekdaysLabel } from "@/lib/schedule";
import { formatPaidDuration, paidHoursError } from "@/lib/shift-entry";

export type OccurrenceKind = "manual" | "scheduled" | "absent" | "hours_override";
export type WeekGridCellKind = "empty" | "scheduled" | "absent" | "hours_override" | "manual";
export type ExceptionKind = "absent" | "worked_as_scheduled" | "hours_override";
export type ExceptionScope = "this_day" | "going_forward";

export const THIS_DAY_ONLY_LABEL = "this day only";
export const THIS_OCCURRENCE_ONLY_LABEL = "this occurrence only";
export const SCHEDULE_GOING_FORWARD_LABEL = "schedule going forward";
export const NOT_WORKED_LABEL = "Not worked";

export type WeekGridSchedule = {
  id: string;
  weekdays: number[];
  paidMinutes: number;
  effectiveFrom: string;
};

export type WeekGridAssignment = {
  id: string;
  contractorId: string;
  siteId: string;
  rateCents: number | null;
  schedule: WeekGridSchedule | null;
};

export type WeekGridEntry = {
  id: string;
  contractorId: string;
  contractorName: string;
  siteId: string;
  siteName: string;
  workDate: string;
  paidMinutes: number;
  rateCents: number;
  notes: string;
  entryMode: "clock" | "paid_hours" | "absent";
  occurrenceKind: OccurrenceKind;
  scheduleVersionId: string | null;
};

export type WeekGridRow = {
  assignmentId: string | null;
  contractorId: string;
  contractorName: string;
  siteId: string;
  siteName: string;
  schedule: WeekGridSchedule | null;
};

export type WeekGridColumn = {
  iso: string;
  weekdayLabel: string;
};

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function weekGridColumns(weekStart: string): WeekGridColumn[] {
  return WEEKDAY_HEADERS.map((weekdayLabel, offset) => ({
    iso: addDaysIso(weekStart, offset),
    weekdayLabel,
  }));
}

export function buildWeekGridRows(input: {
  assignments: WeekGridAssignment[];
  contractors: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  entries: Pick<WeekGridEntry, "contractorId" | "contractorName" | "siteId" | "siteName">[];
}): WeekGridRow[] {
  const contractorName = new Map(input.contractors.map((row) => [row.id, row.name]));
  const siteName = new Map(input.sites.map((row) => [row.id, row.name]));
  const rows = new Map<string, WeekGridRow>();

  for (const assignment of input.assignments) {
    if (!assignment.schedule) continue;
    const key = `${assignment.contractorId}:${assignment.siteId}`;
    rows.set(key, {
      assignmentId: assignment.id,
      contractorId: assignment.contractorId,
      contractorName: contractorName.get(assignment.contractorId) ?? "",
      siteId: assignment.siteId,
      siteName: siteName.get(assignment.siteId) ?? "",
      schedule: assignment.schedule,
    });
  }

  for (const entry of input.entries) {
    const key = `${entry.contractorId}:${entry.siteId}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      assignmentId: null,
      contractorId: entry.contractorId,
      contractorName: entry.contractorName,
      siteId: entry.siteId,
      siteName: entry.siteName,
      schedule: null,
    });
  }

  return [...rows.values()].sort((a, b) => {
    const byContractor = a.contractorName.localeCompare(b.contractorName);
    if (byContractor !== 0) return byContractor;
    return a.siteName.localeCompare(b.siteName);
  });
}

export function weekGridIsEmpty(rows: WeekGridRow[], entries: unknown[]): boolean {
  return rows.length === 0 && entries.length === 0;
}

export function entryForCell<T extends { contractorId: string; siteId: string; workDate: string }>(
  entries: T[],
  contractorId: string,
  siteId: string,
  workDate: string,
): T | null {
  return entries.find((entry) => entry.contractorId === contractorId && entry.siteId === siteId && entry.workDate === workDate) ?? null;
}

export function presentWeekGridCell(entry: Pick<WeekGridEntry, "occurrenceKind" | "paidMinutes"> | null): {
  kind: WeekGridCellKind;
  label: string;
  className: string;
  actions: Array<"worked_as_scheduled" | "absent" | "change_hours" | "edit" | "delete">;
} {
  if (!entry) {
    return { kind: "empty", label: "", className: "week-grid-cell is-empty", actions: [] };
  }
  if (entry.occurrenceKind === "absent") {
    return {
      kind: "absent",
      label: NOT_WORKED_LABEL,
      className: "week-grid-cell is-absent",
      actions: ["worked_as_scheduled", "change_hours"],
    };
  }
  if (entry.occurrenceKind === "scheduled") {
    return {
      kind: "scheduled",
      label: formatPaidDuration(entry.paidMinutes),
      className: "week-grid-cell is-scheduled",
      actions: ["worked_as_scheduled", "absent", "change_hours"],
    };
  }
  if (entry.occurrenceKind === "hours_override") {
    return {
      kind: "hours_override",
      label: formatPaidDuration(entry.paidMinutes),
      className: "week-grid-cell is-hours-override",
      actions: ["worked_as_scheduled", "absent", "change_hours"],
    };
  }
  return {
    kind: "manual",
    label: formatPaidDuration(entry.paidMinutes),
    className: "week-grid-cell is-manual",
    actions: ["edit", "delete"],
  };
}

export function hoursOverrideScopeLabels() {
  return {
    thisDayOnly: THIS_DAY_ONLY_LABEL,
    goingForward: SCHEDULE_GOING_FORWARD_LABEL,
  };
}

export function absentScopeLabel() {
  return THIS_OCCURRENCE_ONLY_LABEL;
}

export function exceptionRequest(entryId: string, input: {
  kind: ExceptionKind;
  paidMinutes?: number;
  scope?: ExceptionScope;
}) {
  if (input.kind === "hours_override") {
    return {
      url: `/api/time-entries/${entryId}/exception`,
      body: {
        kind: "hours_override" as const,
        paidMinutes: input.paidMinutes,
        scope: input.scope ?? "this_day",
      },
    };
  }
  return {
    url: `/api/time-entries/${entryId}/exception`,
    body: {
      kind: input.kind,
      scope: "this_day" as const,
    },
  };
}

export function hoursOverrideError(hours: number, minutePart: number): string | null {
  return paidHoursError(hours, minutePart);
}

export function hoursOverridePaidMinutes(hours: number, minutePart: number): number {
  return paidMinutesFromParts(hours, minutePart);
}

export function rowScheduleCaption(schedule: WeekGridSchedule | null): string | null {
  if (!schedule) return null;
  return `${formatWeekdaysLabel(schedule.weekdays)} · ${formatPaidDuration(schedule.paidMinutes)}/day`;
}
