import { z } from "zod";
import { isIsoDate, isMonday } from "./payroll";

export const PORTAL_UPCOMING_DAYS = 14;

/**
 * Contractor remittance download stays off until a contractor-scoped PDF route exists.
 * The owner route takes a contractor id and is not safe for this app.
 */
export const PORTAL_REMITTANCE_AVAILABLE = false;

const occurrenceKind = z.enum(["manual", "scheduled", "worked", "absent", "hours_override"]);
const entryMode = z.enum(["clock", "paid_hours", "absent"]);

export const portalShiftSchema = z.object({
  id: z.string().min(1),
  businessId: z.string().min(1),
  businessName: z.string(),
  siteName: z.string(),
  address: z.string(),
  workDate: z.string(),
  paidMinutes: z.number().int().min(0),
  entryMode,
  occurrenceKind,
  startMinutes: z.number().int().min(0).max(1439).nullable(),
  endMinutes: z.number().int().min(0).max(1439).nullable(),
  breakMinutes: z.number().int().min(0).max(720).nullable(),
}).strict();

export const portalTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string(),
}).strict();

export const portalDaySchema = z.object({
  date: z.string(),
  shifts: z.array(portalShiftSchema),
}).strict();

export const portalWeekSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  days: z.array(portalDaySchema),
  tasks: z.array(portalTaskSchema),
}).strict();

export const portalUpcomingSchema = z.object({
  from: z.string(),
  to: z.string(),
  days: z.array(portalDaySchema),
}).strict();

export const portalPaymentWeekSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string(),
  paidMinutes: z.number().int().min(0),
  payCents: z.number().int().min(0),
}).strict();

export const portalPaymentsSchema = z.object({
  headline: portalPaymentWeekSchema.extend({
    estimated: z.boolean(),
  }).strict(),
  weeks: z.array(portalPaymentWeekSchema),
}).strict();

export const portalPaymentLineSchema = z.object({
  id: z.string().min(1),
  workDate: z.string(),
  siteName: z.string(),
  businessName: z.string(),
  paidMinutes: z.number().int().min(1),
  payCents: z.number().int().min(0),
}).strict();

export const portalPaymentDetailSchema = portalPaymentWeekSchema.extend({
  lines: z.array(portalPaymentLineSchema),
}).strict();

export type PortalShift = z.infer<typeof portalShiftSchema>;
export type PortalTask = z.infer<typeof portalTaskSchema>;
export type PortalWeek = z.infer<typeof portalWeekSchema>;
export type PortalUpcoming = z.infer<typeof portalUpcomingSchema>;
export type PortalPayments = z.infer<typeof portalPaymentsSchema>;
export type PortalPaymentDetail = z.infer<typeof portalPaymentDetailSchema>;
export type DirectionsPlatform = "ios" | "android" | "web";

const PERSISTED_PORTAL_QUERIES = new Set(["portal-week", "portal-upcoming"]);

export function portalQueryPersists(queryKey: readonly unknown[]): boolean {
  return typeof queryKey[0] === "string" && PERSISTED_PORTAL_QUERIES.has(queryKey[0]);
}

export function addDaysIso(isoDate: string, days: number): string {
  if (!isIsoDate(isoDate) || !Number.isInteger(days)) throw new Error("invalid_request");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function dateIsoWeekday(isoDate: string): number {
  if (!isIsoDate(isoDate)) throw new Error("invalid_request");
  const weekday = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function weekdayMatchesMask(mask: number, weekday: number): boolean {
  if (!Number.isInteger(mask) || mask <= 0 || mask > 127) return false;
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) return false;
  return (mask & (1 << (weekday - 1))) !== 0;
}

export function eachDate(from: string, to: string): string[] {
  if (!isIsoDate(from) || !isIsoDate(to) || to < from) throw new Error("invalid_request");
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    if (dates.length > 370) throw new Error("invalid_request");
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

export function shiftWeek(weekStart: string, direction: -1 | 1): string {
  if (!isMonday(weekStart)) throw new Error("invalid_week");
  return addDaysIso(weekStart, direction * 7);
}

export function aucklandDateIso(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) throw new Error("invalid_request");
  return `${year}-${month}-${day}`;
}

export function upcomingRange(today: string, days = PORTAL_UPCOMING_DAYS): { from: string; to: string } {
  if (!isIsoDate(today) || !Number.isInteger(days) || days < 1 || days > PORTAL_UPCOMING_DAYS) {
    throw new Error("invalid_request");
  }
  return { from: today, to: addDaysIso(today, days - 1) };
}

export function tasksForShifts(shifts: readonly { occurrenceKind: string }[]): PortalTask[] {
  const pending = shifts.filter((shift) => shift.occurrenceKind === "scheduled").length;
  if (pending === 0) return [];
  const title = pending === 1 ? "1 shift still pending" : `${pending} shifts still pending`;
  return [{
    id: "pending-shifts",
    title,
    detail: "These are on your schedule and not marked worked yet.",
  }];
}

export function sumPaidMinutes(shifts: readonly { paidMinutes: number }[]): number {
  return shifts.reduce((sum, shift) => sum + shift.paidMinutes, 0);
}

export function selectNextJob<T extends {
  workDate: string;
  startMinutes: number | null;
  siteName: string;
  occurrenceKind: string;
  id: string;
}>(shifts: readonly T[], today: string): T | null {
  if (!isIsoDate(today)) throw new Error("invalid_request");
  const candidates = shifts.filter((shift) => shift.workDate >= today && shift.occurrenceKind !== "absent");
  candidates.sort((a, b) => {
    if (a.workDate !== b.workDate) return a.workDate < b.workDate ? -1 : 1;
    const aStart = a.startMinutes ?? 24 * 60;
    const bStart = b.startMinutes ?? 24 * 60;
    if (aStart !== bStart) return aStart - bStart;
    const site = a.siteName.localeCompare(b.siteName);
    if (site !== 0) return site;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return candidates[0] ?? null;
}

export function shiftStatusLabel(kind: PortalShift["occurrenceKind"]): string {
  if (kind === "scheduled") return "Pending";
  if (kind === "worked") return "Worked";
  if (kind === "absent") return "Didn't work";
  if (kind === "hours_override") return "Changed hours";
  return "Recorded";
}

export function formatClockMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) throw new Error("invalid_request");
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const period = hour24 >= 12 ? "pm" : "am";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

export function formatShiftTime(shift: Pick<PortalShift, "entryMode" | "occurrenceKind" | "startMinutes" | "endMinutes" | "breakMinutes" | "paidMinutes">): string {
  if (shift.occurrenceKind === "absent" || shift.entryMode === "absent") return "Didn't work";
  if (shift.entryMode === "clock" && shift.startMinutes != null && shift.endMinutes != null) {
    const range = `${formatClockMinutes(shift.startMinutes)} – ${formatClockMinutes(shift.endMinutes)}`;
    if (shift.breakMinutes) return `${range}, ${shift.breakMinutes} min break`;
    return range;
  }
  const abs = Math.abs(shift.paidMinutes);
  const sign = shift.paidMinutes < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, "0")}m`;
}

export function formatDayHeading(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error("invalid_request");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getUTCDay()];
  const rest = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return `${weekday} ${rest}`;
}

export function formatWeekRange(weekStart: string, end: string): string {
  if (!isMonday(weekStart) || !isIsoDate(end)) throw new Error("invalid_week");
  const startLabel = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00.000Z`));
  const endLabel = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${end}T00:00:00.000Z`));
  return `${startLabel} – ${endLabel}`;
}

export function formatUpdatedTime(timestamp: number): string {
  if (!Number.isFinite(timestamp)) throw new Error("invalid_request");
  return new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Pacific/Auckland",
  }).format(new Date(timestamp));
}

export function offlineBannerText(updatedAt: number | null): string {
  if (updatedAt == null) return "Offline. Last updated time is not saved yet.";
  return `Offline. Last updated ${formatUpdatedTime(updatedAt)}.`;
}

const SMALL = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;

function wordsUnder1000(value: number): string {
  if (value < 20) return SMALL[value] ?? "zero";
  if (value < 100) {
    const rest = value % 10;
    const tens = TENS[Math.floor(value / 10)] ?? "";
    return rest ? `${tens}-${SMALL[rest]}` : tens;
  }
  const rest = value % 100;
  const hundreds = `${SMALL[Math.floor(value / 100)]} hundred`;
  return rest ? `${hundreds} ${wordsUnder1000(rest)}` : hundreds;
}

function integerWords(value: number): string {
  if (value < 1000) return wordsUnder1000(value);
  const scales: Array<[number, string]> = [
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"],
  ];
  const parts: string[] = [];
  let rest = value;
  for (const [scale, name] of scales) {
    if (rest < scale) continue;
    parts.push(`${wordsUnder1000(Math.floor(rest / scale))} ${name}`);
    rest %= scale;
  }
  if (rest) parts.push(wordsUnder1000(rest));
  return parts.join(" ");
}

export function spokenNzd(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("invalid_pay_input");
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const dollarPart = `${integerWords(dollars)} ${dollars === 1 ? "dollar" : "dollars"}`;
  const body = remainder === 0
    ? dollarPart
    : `${dollarPart} and ${integerWords(remainder)} ${remainder === 1 ? "cent" : "cents"}`;
  return negative ? `minus ${body}` : body;
}

export function directionsUrl(address: string, platform: DirectionsPlatform): string | null {
  const query = address.replace(/[\u0000-\u001f]+/g, " ").trim();
  if (!query) return null;
  const encoded = encodeURIComponent(query);
  if (platform === "ios") return `https://maps.apple.com/?daddr=${encoded}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
}

export function showsBusinessName(shifts: readonly { businessId: string }[]): boolean {
  return new Set(shifts.map((shift) => shift.businessId)).size > 1;
}
