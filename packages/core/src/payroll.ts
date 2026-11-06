export type PayrollEntry = {
  contractorId: string;
  contractorName: string;
  paidMinutes: number;
  rateCents: number;
  payMode?: "hourly" | "fixed";
  fixedPayCents?: number | null;
  holidayLoadingCents?: number;
  weekendLoadingCents?: number;
  overnightLoadingCents?: number;
};

export type ShiftPayEntry = {
  workDate: string;
  paidMinutes: number;
  rateCents: number;
  startMinutes: number;
  endMinutes: number;
  payMode?: "hourly" | "fixed";
  fixedPayCents?: number | null;
};

export type ShiftPayRules = {
  holidayMode?: "off" | "multiplier";
  holidayMultiplierBps?: number | null;
  weekendSaturdayMultiplierBps?: number | null;
  weekendSundayMultiplierBps?: number | null;
  overnightStartMinutes?: number | null;
  overnightEndMinutes?: number | null;
  overnightMultiplierBps?: number | null;
};

export type ShiftPayBreakdown = {
  baseCents: number;
  holidayLoadingCents: number;
  weekendLoadingCents: number;
  overnightLoadingCents: number;
  fixedCents: number;
  totalCents: number;
};

export type NzPublicHoliday = { date: string; name: string };

export type ContractorWeek = {
  contractorId: string;
  contractorName: string;
  paidMinutes: number;
  payCents: number;
};

export const MAX_SAME_DAY_MINUTES = 1_439;

export function calculatePaidMinutes(startMinutes: number, endMinutes: number, breakMinutes: number): number {
  const paid = endMinutes - startMinutes - breakMinutes;
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || !Number.isInteger(breakMinutes) || paid <= 0) {
    throw new Error("invalid_shift");
  }
  return paid;
}

export function paidMinutesFromParts(hours: number, minutePart: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutePart) || hours < 0 || minutePart < 0 || minutePart > 59) {
    throw new Error("invalid_shift");
  }
  const paid = hours * 60 + minutePart;
  if (paid <= 0 || paid > MAX_SAME_DAY_MINUTES) throw new Error("invalid_shift");
  return paid;
}

export function calculateEntryPayCents(paidMinutes: number, rateCents: number): number {
  if (!Number.isInteger(paidMinutes) || !Number.isInteger(rateCents) || paidMinutes <= 0 || rateCents <= 0) {
    throw new Error("invalid_pay_input");
  }
  return Math.round((paidMinutes * rateCents) / 60);
}

function isoDate(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, month, 1 + offset + (occurrence - 1) * 7);
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function addHoliday(target: NzPublicHoliday[], date: string, name: string): void {
  target.push({ date, name });
}

function addMondayisedHoliday(target: NzPublicHoliday[], date: string, name: string): void {
  addHoliday(target, date, name);
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  if (weekday === 6) addHoliday(target, addDays(date, 2), `${name} observed`);
  if (weekday === 0) addHoliday(target, addDays(date, 1), `${name} observed`);
}

function addMondayisedPair(
  target: NzPublicHoliday[],
  firstDate: string,
  firstName: string,
  secondDate: string,
  secondName: string,
): void {
  addHoliday(target, firstDate, firstName);
  addHoliday(target, secondDate, secondName);
  const firstWeekday = new Date(`${firstDate}T00:00:00.000Z`).getUTCDay();
  if (firstWeekday === 6 || firstWeekday === 0) {
    const mondayOffset = firstWeekday === 6 ? 2 : 1;
    addHoliday(target, addDays(firstDate, mondayOffset), `${firstName} observed`);
    addHoliday(target, addDays(firstDate, mondayOffset + 1), `${secondName} observed`);
  } else {
    const secondWeekday = new Date(`${secondDate}T00:00:00.000Z`).getUTCDay();
    if (secondWeekday === 6) addHoliday(target, addDays(secondDate, 2), `${secondName} observed`);
    if (secondWeekday === 0) addHoliday(target, addDays(secondDate, 1), `${secondName} observed`);
  }
}

const MATARIKI_DATES: Record<number, string> = {
  2024: "2024-06-28",
  2025: "2025-06-20",
  2026: "2026-07-10",
  2027: "2027-06-25",
  2028: "2028-07-14",
  2029: "2029-07-06",
  2030: "2030-06-21",
};

export function nzPublicHolidayDates(year: number): NzPublicHoliday[] {
  if (!Number.isInteger(year) || year < 2024 || year > 2030) throw new Error("unsupported_holiday_year");
  const holidays: NzPublicHoliday[] = [];
  addMondayisedPair(holidays, isoDate(year, 1, 1), "New Year's Day", isoDate(year, 1, 2), "Day after New Year's Day");
  addMondayisedHoliday(holidays, isoDate(year, 2, 6), "Waitangi Day");
  const easter = easterSunday(year);
  addHoliday(holidays, addDays(easter, -2), "Good Friday");
  addHoliday(holidays, addDays(easter, 1), "Easter Monday");
  addMondayisedHoliday(holidays, isoDate(year, 4, 25), "ANZAC Day");
  addHoliday(holidays, nthWeekday(year, 6, 1, 1), "King's Birthday");
  addHoliday(holidays, MATARIKI_DATES[year]!, "Matariki");
  addHoliday(holidays, nthWeekday(year, 10, 1, 4), "Labour Day");
  addMondayisedPair(holidays, isoDate(year, 12, 25), "Christmas Day", isoDate(year, 12, 26), "Boxing Day");
  return holidays.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

function overlap(start: number, end: number, windowStart: number, windowEnd: number): number {
  return Math.max(0, Math.min(end, windowEnd) - Math.max(start, windowStart));
}

export function overnightOverlapMinutes(
  startMinutes: number,
  endMinutes: number,
  windowStart: number,
  windowEnd: number,
): number {
  if (![startMinutes, endMinutes, windowStart, windowEnd].every(Number.isInteger)) throw new Error("invalid_shift");
  if (startMinutes < 0 || endMinutes > 1440 || startMinutes > endMinutes || windowStart < 0 || windowStart > 1440 || windowEnd < 0 || windowEnd > 1440) {
    throw new Error("invalid_shift");
  }
  if (windowStart === windowEnd) return 0;
  if (windowStart < windowEnd) return overlap(startMinutes, endMinutes, windowStart, windowEnd);
  return overlap(startMinutes, endMinutes, windowStart, 1440) + overlap(startMinutes, endMinutes, 0, windowEnd);
}

function loading(baseCents: number, multiplierBps: number | null | undefined): number {
  if (!Number.isInteger(multiplierBps) || multiplierBps == null || multiplierBps < 10_000) return 0;
  return Math.round((baseCents * (multiplierBps - 10_000)) / 10_000);
}

export function calculateShiftPay(
  entry: ShiftPayEntry,
  rules: ShiftPayRules | null | undefined,
  holidayDates: ReadonlySet<string> | readonly string[],
): ShiftPayBreakdown {
  if (entry.paidMinutes <= 0) {
    return { baseCents: 0, holidayLoadingCents: 0, weekendLoadingCents: 0, overnightLoadingCents: 0, fixedCents: 0, totalCents: 0 };
  }
  if (entry.payMode === "fixed" && Number.isInteger(entry.fixedPayCents) && (entry.fixedPayCents ?? 0) > 0) {
    const fixedCents = entry.fixedPayCents!;
    return { baseCents: 0, holidayLoadingCents: 0, weekendLoadingCents: 0, overnightLoadingCents: 0, fixedCents, totalCents: fixedCents };
  }
  const baseCents = calculateEntryPayCents(entry.paidMinutes, entry.rateCents);
  const holidaySet = holidayDates instanceof Set ? holidayDates : new Set(holidayDates);
  let holidayLoadingCents = 0;
  let weekendLoadingCents = 0;
  if (rules?.holidayMode === "multiplier" && holidaySet.has(entry.workDate)) {
    holidayLoadingCents = loading(baseCents, rules.holidayMultiplierBps);
  } else {
    const weekday = new Date(`${entry.workDate}T00:00:00.000Z`).getUTCDay();
    const multiplier = weekday === 6
      ? rules?.weekendSaturdayMultiplierBps
      : weekday === 0
        ? rules?.weekendSundayMultiplierBps
        : null;
    weekendLoadingCents = loading(baseCents, multiplier);
  }
  let overnightLoadingCents = 0;
  if (rules?.overnightStartMinutes != null && rules.overnightEndMinutes != null && rules.overnightMultiplierBps != null) {
    const overlapMinutes = Math.min(
      entry.paidMinutes,
      overnightOverlapMinutes(entry.startMinutes, entry.endMinutes, rules.overnightStartMinutes, rules.overnightEndMinutes),
    );
    if (overlapMinutes > 0) {
      overnightLoadingCents = loading(calculateEntryPayCents(overlapMinutes, entry.rateCents), rules.overnightMultiplierBps);
    }
  }
  return {
    baseCents,
    holidayLoadingCents,
    weekendLoadingCents,
    overnightLoadingCents,
    fixedCents: 0,
    totalCents: baseCents + holidayLoadingCents + weekendLoadingCents + overnightLoadingCents,
  };
}

export function snapshotShiftPay(entry: {
  paidMinutes: number;
  rateCents: number;
  payMode?: "hourly" | "fixed";
  fixedPayCents?: number | null;
  holidayLoadingCents?: number;
  weekendLoadingCents?: number;
  overnightLoadingCents?: number;
}): ShiftPayBreakdown {
  if (entry.paidMinutes <= 0) {
    return { baseCents: 0, holidayLoadingCents: 0, weekendLoadingCents: 0, overnightLoadingCents: 0, fixedCents: 0, totalCents: 0 };
  }
  if (entry.payMode === "fixed" && Number.isInteger(entry.fixedPayCents) && (entry.fixedPayCents ?? 0) > 0) {
    const fixedCents = entry.fixedPayCents!;
    return { baseCents: 0, holidayLoadingCents: 0, weekendLoadingCents: 0, overnightLoadingCents: 0, fixedCents, totalCents: fixedCents };
  }
  const baseCents = calculateEntryPayCents(entry.paidMinutes, entry.rateCents);
  const holidayLoadingCents = entry.holidayLoadingCents ?? 0;
  const weekendLoadingCents = entry.weekendLoadingCents ?? 0;
  const overnightLoadingCents = entry.overnightLoadingCents ?? 0;
  return {
    baseCents,
    holidayLoadingCents,
    weekendLoadingCents,
    overnightLoadingCents,
    fixedCents: 0,
    totalCents: baseCents + holidayLoadingCents + weekendLoadingCents + overnightLoadingCents,
  };
}

export function summarizeWeek(entries: PayrollEntry[]): ContractorWeek[] {
  const totals = new Map<string, ContractorWeek>();
  for (const entry of entries) {
    const current = totals.get(entry.contractorId) ?? {
      contractorId: entry.contractorId,
      contractorName: entry.contractorName,
      paidMinutes: 0,
      payCents: 0,
    };
    current.paidMinutes += entry.paidMinutes;
    if (entry.paidMinutes > 0) {
      current.payCents += snapshotShiftPay(entry).totalCents;
    }
    totals.set(entry.contractorId, current);
  }
  return [...totals.values()].sort((a, b) => a.contractorName.localeCompare(b.contractorName));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isMonday(value: string): boolean {
  return isIsoDate(value) && new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
}

export function weekEnd(weekStart: string): string {
  if (!isMonday(weekStart)) throw new Error("invalid_week_start");
  const end = new Date(`${weekStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

export function weekStartFromDate(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error("invalid_week_start");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

export function weekPayrollTotals(entries: ReadonlyArray<{
  paidMinutes: number;
  rateCents: number;
  payMode?: "hourly" | "fixed";
  fixedPayCents?: number | null;
  holidayLoadingCents?: number;
  weekendLoadingCents?: number;
  overnightLoadingCents?: number;
}>): {
  currentPaidMinutes: number;
  currentPayCents: number;
} {
  let currentPaidMinutes = 0;
  let currentPayCents = 0;
  for (const entry of entries) {
    currentPaidMinutes += entry.paidMinutes;
    if (entry.paidMinutes > 0) {
      currentPayCents += snapshotShiftPay(entry).totalCents;
    }
  }
  return { currentPaidMinutes, currentPayCents };
}
