import { isIsoDate, weekEnd, weekStartFromDate } from "@cleantrack/core/payroll";
import { formatDayHeading } from "@cleantrack/core/portal";

export type DayWithShifts<T> = {
  date: string;
  shifts: readonly T[];
};

export type CollapsedDay<T> =
  | { kind: "day"; day: DayWithShifts<T>; isToday: boolean }
  | { kind: "empty"; from: string; to: string };

/**
 * Consecutive empty days become one row. Today stays on its own so the week
 * can highlight it even when that day has no shifts.
 */
export function collapseEmptyDays<T>(days: readonly DayWithShifts<T>[], today: string): CollapsedDay<T>[] {
  const groups: CollapsedDay<T>[] = [];
  let emptyFrom: string | null = null;
  let emptyTo: string | null = null;

  const flush = () => {
    if (!emptyFrom || !emptyTo) return;
    groups.push({ kind: "empty", from: emptyFrom, to: emptyTo });
    emptyFrom = null;
    emptyTo = null;
  };

  for (const day of days) {
    if (day.shifts.length === 0 && day.date !== today) {
      emptyFrom ??= day.date;
      emptyTo = day.date;
      continue;
    }
    flush();
    groups.push({ kind: "day", day, isToday: day.date === today });
  }
  flush();
  return groups;
}

export function emptySpanLabel(from: string, to: string): string {
  if (from === to) return `${formatDayHeading(from)}, no shifts`;
  return `${formatDayHeading(from)} – ${formatDayHeading(to)}, no shifts`;
}

export function isCurrentWeek(weekStart: string, today: string): boolean {
  if (!isIsoDate(today)) return false;
  return weekStartFromDate(today) === weekStart;
}

export function weekIncludesDate(weekStart: string, today: string): boolean {
  if (!isIsoDate(weekStart) || !isIsoDate(today)) return false;
  try {
    const end = weekEnd(weekStart);
    return today >= weekStart && today <= end;
  } catch {
    return false;
  }
}

export function weekDayProgress(weekStart: string, today: string): { value: number; label: string } {
  if (!isIsoDate(today)) return { value: 0, label: "Week progress unavailable" };
  let end: string;
  try {
    end = weekEnd(weekStart);
  } catch {
    return { value: 0, label: "Week progress unavailable" };
  }
  if (today < weekStart) return { value: 0, label: "This week has not started" };
  if (today > end) return { value: 1, label: "This week is complete" };
  const day = Math.round((Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${weekStart}T00:00:00.000Z`)) / 86_400_000) + 1;
  const clamped = Math.min(7, Math.max(1, day));
  return { value: clamped / 7, label: `Day ${clamped} of 7` };
}

export type PayWeekStatus = "Approved" | "Estimated";

export type PayWeekInput = {
  weekStart: string;
  weekEnd: string;
  paidMinutes: number;
  payCents: number;
};

export type PayWeekRow = PayWeekInput & { status: PayWeekStatus };

export function payWeekRows(input: {
  headline: PayWeekInput & { estimated: boolean };
  weeks: readonly PayWeekInput[];
}): { approvedCents: number; approvedMinutes: number; rows: PayWeekRow[] } {
  const approvedCents = input.weeks.reduce((sum, week) => sum + week.payCents, 0);
  const approvedMinutes = input.weeks.reduce((sum, week) => sum + week.paidMinutes, 0);
  const rows: PayWeekRow[] = input.weeks.map((week) => ({ ...week, status: "Approved" }));
  const headlineListed = input.weeks.some((week) => week.weekStart === input.headline.weekStart);
  if (input.headline.estimated && !headlineListed) {
    rows.unshift({
      weekStart: input.headline.weekStart,
      weekEnd: input.headline.weekEnd,
      paidMinutes: input.headline.paidMinutes,
      payCents: input.headline.payCents,
      status: "Estimated",
    });
  }
  return { approvedCents, approvedMinutes, rows };
}

export function formatAppBuild(version: string, channel: string | null): string {
  const versionLabel = version.trim() || "0.1.0";
  const channelLabel = channel?.trim() ?? "";
  if (!channelLabel) return `Version ${versionLabel}`;
  return `Version ${versionLabel} · ${channelLabel}`;
}

const ACCOUNT_WEB_PATHS = {
  help: "/",
  resetPassword: "/sign-in",
} as const;

export function accountWebUrl(baseUrl: string, link: keyof typeof ACCOUNT_WEB_PATHS): string {
  const base = baseUrl.replace(/\/+$/, "");
  const path = ACCOUNT_WEB_PATHS[link];
  if (path === "/") return `${base}/`;
  return `${base}${path}`;
}
