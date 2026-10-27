import { paidMinutesFromParts } from "@/lib/payroll";
import { addDaysIso, formatWeekdaysLabel } from "@/lib/schedule";
import { formatPaidDuration, paidHoursError } from "@/lib/shift-entry";

export type OccurrenceKind = "manual" | "scheduled" | "worked" | "absent" | "hours_override";
export type WeekGridCellKind = "empty" | "scheduled" | "worked" | "absent" | "hours_override" | "manual";
export type ExceptionKind = "absent" | "worked_as_scheduled" | "hours_override" | "confirm_worked";
export type ExceptionScope = "this_day" | "going_forward";
export type WeekGridMenuAction = "absent" | "change_hours" | "reset" | "edit" | "delete";
export type WeekGridIcon = "pending" | "check" | "changed" | "absent" | "manual" | "none";

export const THIS_DAY_ONLY_LABEL = "this day only";
export const THIS_OCCURRENCE_ONLY_LABEL = "this occurrence only";
export const SCHEDULE_GOING_FORWARD_LABEL = "schedule going forward";
export const NOT_WORKED_LABEL = "Didn't work";

export const WEEK_GRID_LEGEND = [
  { kind: "scheduled", label: "Pending", icon: "pending" },
  { kind: "worked", label: "Worked", icon: "check" },
  { kind: "hours_override", label: "Changed hours", icon: "changed" },
  { kind: "absent", label: "Didn't work", icon: "absent" },
] as const;

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

const SCHEDULE_MENU: WeekGridMenuAction[] = ["absent", "change_hours", "reset"];

export type WeekGridCell = {
  kind: WeekGridCellKind;
  label: string;
  statusLabel: string;
  ariaLabel: string;
  className: string;
  icon: WeekGridIcon;
  strike: boolean;
  tapToMarkWorked: boolean;
  menu: WeekGridMenuAction[];
};

function durationLabel(minutes: number) {
  return formatPaidDuration(minutes);
}

function changedHoursLabel(actualMinutes: number, scheduledMinutes: number | null) {
  const actual = durationLabel(actualMinutes);
  if (scheduledMinutes == null) return actual;
  return `${actual} (sched ${durationLabel(scheduledMinutes)})`;
}

function emptyCell(): WeekGridCell {
  return {
    kind: "empty",
    label: "",
    statusLabel: "",
    ariaLabel: "No shift",
    className: "week-grid-cell is-empty",
    icon: "none",
    strike: false,
    tapToMarkWorked: false,
    menu: [],
  };
}

function pendingCell(minutes: number): WeekGridCell {
  const label = durationLabel(minutes);
  return {
    kind: "scheduled",
    label,
    statusLabel: "Pending",
    ariaLabel: `Pending, ${label} scheduled`,
    className: "week-grid-cell is-pending",
    icon: "pending",
    strike: false,
    tapToMarkWorked: true,
    menu: SCHEDULE_MENU,
  };
}

function workedCell(minutes: number): WeekGridCell {
  const label = durationLabel(minutes);
  return {
    kind: "worked",
    label,
    statusLabel: "Worked",
    ariaLabel: `Worked as scheduled, ${label}`,
    className: "week-grid-cell is-worked",
    icon: "check",
    strike: false,
    tapToMarkWorked: false,
    menu: SCHEDULE_MENU,
  };
}

function changedCell(actualMinutes: number, scheduledMinutes: number | null): WeekGridCell {
  const scheduled = scheduledMinutes == null ? "" : durationLabel(scheduledMinutes);
  return {
    kind: "hours_override",
    label: changedHoursLabel(actualMinutes, scheduledMinutes),
    statusLabel: "Changed",
    ariaLabel: scheduled ? `Changed hours, ${durationLabel(actualMinutes)}, scheduled ${scheduled}` : `Changed hours, ${durationLabel(actualMinutes)}`,
    className: "week-grid-cell is-changed",
    icon: "changed",
    strike: false,
    tapToMarkWorked: false,
    menu: SCHEDULE_MENU,
  };
}

function absentCell(scheduledMinutes: number | null): WeekGridCell {
  const planned = scheduledMinutes != null && scheduledMinutes > 0 ? durationLabel(scheduledMinutes) : "";
  return {
    kind: "absent",
    label: planned,
    statusLabel: NOT_WORKED_LABEL,
    ariaLabel: planned ? `Didn't work, ${planned} scheduled` : "Didn't work",
    className: "week-grid-cell is-absent",
    icon: "absent",
    strike: planned.length > 0,
    tapToMarkWorked: false,
    menu: SCHEDULE_MENU,
  };
}

function manualCell(minutes: number): WeekGridCell {
  const label = durationLabel(minutes);
  return {
    kind: "manual",
    label,
    statusLabel: "Added",
    ariaLabel: `Added shift, ${label}`,
    className: "week-grid-cell is-manual",
    icon: "manual",
    strike: false,
    tapToMarkWorked: false,
    menu: ["edit", "delete"],
  };
}

export function presentWeekGridCell(
  entry: Pick<WeekGridEntry, "occurrenceKind" | "paidMinutes"> | null,
  scheduledMinutes: number | null = null,
): WeekGridCell {
  if (!entry) return emptyCell();
  if (entry.occurrenceKind === "absent") return absentCell(scheduledMinutes);
  if (entry.occurrenceKind === "scheduled") return pendingCell(entry.paidMinutes);
  if (entry.occurrenceKind === "worked") return workedCell(entry.paidMinutes);
  if (entry.occurrenceKind === "hours_override") return changedCell(entry.paidMinutes, scheduledMinutes);
  return manualCell(entry.paidMinutes);
}

export function cellAriaLabel(
  cell: Pick<WeekGridCell, "ariaLabel" | "tapToMarkWorked">,
  context: { contractorName: string; siteName: string; dayLabel: string },
  locked: boolean,
): string {
  const named = `${cell.ariaLabel}, ${context.contractorName} at ${context.siteName}, ${context.dayLabel}`;
  if (locked) return `${named}, read-only`;
  if (cell.tapToMarkWorked) return `${named}. Mark worked`;
  return named;
}

export function weekGridMenuLabel(action: WeekGridMenuAction): string {
  if (action === "absent") return "Didn't work";
  if (action === "change_hours") return "Change hours";
  if (action === "reset") return "Reset to scheduled";
  if (action === "edit") return "Edit shift";
  return "Delete shift";
}

export function pendingEntryIds(
  entries: Array<Pick<WeekGridEntry, "id" | "contractorId" | "siteId" | "workDate" | "occurrenceKind">>,
  contractorId: string,
  siteId: string,
  dates: string[],
): string[] {
  const ids: string[] = [];
  for (const workDate of dates) {
    const entry = entryForCell(entries, contractorId, siteId, workDate);
    if (entry?.occurrenceKind === "scheduled") ids.push(entry.id);
  }
  return ids;
}

export type OccurrenceProjection =
  | { kind: "confirm_worked" }
  | { kind: "worked_as_scheduled"; scheduledMinutes: number | null }
  | { kind: "absent" }
  | { kind: "hours_override"; paidMinutes: number };

export function projectOccurrence<T extends WeekGridEntry>(entry: T, change: OccurrenceProjection): T {
  if (change.kind === "confirm_worked") {
    return { ...entry, occurrenceKind: "worked", entryMode: "paid_hours" };
  }
  if (change.kind === "absent") {
    return { ...entry, occurrenceKind: "absent", entryMode: "absent", paidMinutes: 0 };
  }
  if (change.kind === "hours_override") {
    return { ...entry, occurrenceKind: "hours_override", entryMode: "paid_hours", paidMinutes: change.paidMinutes };
  }
  const paidMinutes = change.scheduledMinutes ?? entry.paidMinutes;
  return { ...entry, occurrenceKind: "scheduled", entryMode: "paid_hours", paidMinutes };
}

export function projectEntries<T extends WeekGridEntry>(entries: T[], ids: string[], change: OccurrenceProjection): T[] {
  const selected = new Set(ids);
  return entries.map((entry) => selected.has(entry.id) ? projectOccurrence(entry, change) : entry);
}

export function entryIdFromExceptionUrl(url: string): string | null {
  const match = /^\/api\/time-entries\/([^/]+)\/exception$/.exec(url);
  return match?.[1] ?? null;
}

export function projectionFromExceptionBody(body: unknown, scheduledMinutes: number | null): OccurrenceProjection | null {
  if (!body || typeof body !== "object") return null;
  const record = body as { kind?: unknown; paidMinutes?: unknown };
  if (record.kind === "confirm_worked") return { kind: "confirm_worked" };
  if (record.kind === "absent") return { kind: "absent" };
  if (record.kind === "worked_as_scheduled") return { kind: "worked_as_scheduled", scheduledMinutes };
  if (record.kind === "hours_override" && Number.isInteger(record.paidMinutes)) {
    return { kind: "hours_override", paidMinutes: record.paidMinutes as number };
  }
  return null;
}

export function entriesAfterException<T extends WeekGridEntry>(
  entries: T[],
  scheduledMinutes: number | null,
  url: string,
  body: unknown,
): T[] | null {
  const id = entryIdFromExceptionUrl(url);
  const change = projectionFromExceptionBody(body, scheduledMinutes);
  if (!id || !change) return null;
  return projectEntries(entries, [id], change);
}

export function scheduledMinutesForEntry(
  entries: Array<Pick<WeekGridEntry, "id" | "contractorId" | "siteId">>,
  assignments: Array<{ contractorId: string; siteId: string; schedule: { paidMinutes: number } | null }>,
  entryId: string,
): number | null {
  const entry = entries.find((row) => row.id === entryId);
  if (!entry) return null;
  const assignment = assignments.find((row) => row.contractorId === entry.contractorId && row.siteId === entry.siteId);
  return assignment?.schedule?.paidMinutes ?? null;
}

export function markWorkedRequests(ids: string[]) {
  return ids.map((id) => exceptionRequest(id, { kind: "confirm_worked" }));
}

export function resetScheduledRequests(ids: string[]) {
  return ids.map((id) => exceptionRequest(id, { kind: "worked_as_scheduled" }));
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

const MENU_GAP = 4;

export type MenuAnchor = { top: number; left: number; width: number; height: number };
export type MenuPlacement = { top: number; left: number; placement: "above" | "below" };

export function placeWeekGridMenu(
  anchor: MenuAnchor,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
): MenuPlacement {
  const roomBelow = viewport.height - (anchor.top + anchor.height) - MENU_GAP;
  const roomAbove = anchor.top - MENU_GAP;
  const placement = roomBelow >= menu.height || roomBelow >= roomAbove ? "below" : "above";
  let top = placement === "above" ? anchor.top - MENU_GAP - menu.height : anchor.top + anchor.height + MENU_GAP;
  let left = anchor.left + anchor.width - menu.width;
  if (left < MENU_GAP) left = anchor.left;
  if (left + menu.width > viewport.width - MENU_GAP) left = viewport.width - MENU_GAP - menu.width;
  if (left < MENU_GAP) left = MENU_GAP;
  if (top < MENU_GAP) top = MENU_GAP;
  const maxTop = viewport.height - menu.height - MENU_GAP;
  if (top > maxTop) top = Math.max(MENU_GAP, maxTop);
  return { top, left, placement };
}

export function nextMenuIndex(current: number, length: number, key: string): number | null {
  if (key !== "ArrowDown" && key !== "ArrowUp") return null;
  if (length <= 0) return null;
  if (current < 0) return key === "ArrowDown" ? 0 : length - 1;
  if (key === "ArrowDown") return (current + 1) % length;
  return (current - 1 + length) % length;
}

export function menuKeyAction(input: {
  key: string;
  activeIndex: number;
  length: number;
  focusInMenu: boolean;
}): "close" | number | null {
  if (input.key === "Escape") return "close";
  if (!input.focusInMenu) return null;
  return nextMenuIndex(input.activeIndex, input.length, input.key);
}

export function menuPointerIsInside(target: Node | null, trigger: Node, menu: Node): boolean {
  if (!target) return false;
  return trigger.contains(target) || menu.contains(target);
}
