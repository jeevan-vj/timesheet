import { isIsoDate, isMonday, weekEnd } from "@/lib/payroll";
import { formatNzd, formatPaidDuration } from "@/lib/shift-entry";

export const WEEKDAY_MON = 1;
export const WEEKDAY_TUE = 2;
export const WEEKDAY_WED = 3;
export const WEEKDAY_THU = 4;
export const WEEKDAY_FRI = 5;
export const WEEKDAY_SAT = 6;
export const WEEKDAY_SUN = 7;

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MAX_WEEKDAYS_MASK = 127;

function requireIsoDate(value: string): string {
  if (!isIsoDate(value)) throw new Error("invalid_request");
  return value;
}

export function encodeWeekdays(days: number[]): number {
  if (!Array.isArray(days) || days.length === 0) throw new Error("invalid_request");
  const seen = new Set<number>();
  let mask = 0;
  for (const day of days) {
    if (!Number.isInteger(day) || day < WEEKDAY_MON || day > WEEKDAY_SUN || seen.has(day)) {
      throw new Error("invalid_request");
    }
    seen.add(day);
    mask |= 1 << (day - 1);
  }
  return mask;
}

export function decodeWeekdays(mask: number): number[] {
  if (!Number.isInteger(mask) || mask <= 0 || mask > MAX_WEEKDAYS_MASK) throw new Error("invalid_request");
  const days: number[] = [];
  for (let day = WEEKDAY_MON; day <= WEEKDAY_SUN; day++) {
    if ((mask & (1 << (day - 1))) !== 0) days.push(day);
  }
  if (days.length === 0) throw new Error("invalid_request");
  return days;
}

export function dateIsoWeekday(isoDate: string): number {
  const date = new Date(`${requireIsoDate(isoDate)}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  return weekday === 0 ? WEEKDAY_SUN : weekday;
}

export function addDaysIso(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("invalid_request");
  const date = new Date(`${requireIsoDate(isoDate)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function expandScheduledDates(input: {
  weekStart: string;
  weekdaysMask: number;
  paidMinutes: number;
  effectiveFrom: string;
  effectiveTo: string | null;
}): { workDate: string; paidMinutes: number }[] {
  if (!isMonday(input.weekStart)) throw new Error("invalid_week");
  const effectiveFrom = requireIsoDate(input.effectiveFrom);
  const effectiveTo = input.effectiveTo == null ? null : requireIsoDate(input.effectiveTo);
  if (effectiveTo != null && effectiveTo < effectiveFrom) throw new Error("invalid_request");
  if (!Number.isInteger(input.paidMinutes) || input.paidMinutes <= 0) throw new Error("invalid_request");
  const weekdays = new Set(decodeWeekdays(input.weekdaysMask));
  const end = weekEnd(input.weekStart);
  const rows: { workDate: string; paidMinutes: number }[] = [];
  for (let offset = 0; offset <= 6; offset++) {
    const workDate = addDaysIso(input.weekStart, offset);
    if (workDate > end) break;
    if (!weekdays.has(dateIsoWeekday(workDate))) continue;
    if (workDate < effectiveFrom) continue;
    if (effectiveTo != null && workDate > effectiveTo) continue;
    rows.push({ workDate, paidMinutes: input.paidMinutes });
  }
  return rows;
}

export function planCloseAndOpenVersions(input: {
  currentEffectiveFrom: string;
  newEffectiveFrom: string;
}): { closeEffectiveTo: string; newEffectiveFrom: string } {
  requireIsoDate(input.currentEffectiveFrom);
  if (!isMonday(input.newEffectiveFrom)) throw new Error("invalid_week");
  return {
    closeEffectiveTo: addDaysIso(input.newEffectiveFrom, -1),
    newEffectiveFrom: input.newEffectiveFrom,
  };
}

export function midWeekGoingForward(workDate: string): { thisDayOnly: boolean; newEffectiveFrom: string } {
  const weekday = dateIsoWeekday(workDate);
  if (weekday === WEEKDAY_MON) {
    return { thisDayOnly: false, newEffectiveFrom: workDate };
  }
  return { thisDayOnly: true, newEffectiveFrom: addDaysIso(workDate, 8 - weekday) };
}

export function formatWeekdaysLabel(weekdays: number[]): string {
  const days = decodeWeekdays(encodeWeekdays(weekdays));
  const labels = days.map((day) => WEEKDAY_LABELS[day - 1]);
  const contiguous = days.length >= 2 && days[days.length - 1]! - days[0]! + 1 === days.length;
  if (contiguous) return `${labels[0]}–${labels[labels.length - 1]}`;
  return labels.join(", ");
}

export function shouldSkipExistingEntry(existing: { id: string } | null): boolean {
  return existing != null;
}

export function scheduleSummaryText(input: {
  contractorName: string;
  siteName: string;
  rateCents: number;
  weekdays: number[];
  paidMinutes: number;
}): string {
  if (!Number.isInteger(input.rateCents) || input.rateCents <= 0) throw new Error("invalid_request");
  if (!Number.isInteger(input.paidMinutes) || input.paidMinutes <= 0) throw new Error("invalid_request");
  const days = formatWeekdaysLabel(input.weekdays);
  const duration = formatPaidDuration(input.paidMinutes);
  return `${input.contractorName} — ${input.siteName}\n${formatNzd(input.rateCents)}/hr · ${days} · ${duration}/day`;
}
