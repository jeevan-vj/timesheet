import { z } from "zod";
import { ENGAGEMENT_STATUSES, gstNumberDigits } from "@/lib/contractor-lifecycle";
import { isIsoDate, isMonday } from "@/lib/payroll";

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) => z.string().trim().max(max).default("");
const rateCents = z.number().int().min(1_500).max(25_000);

export const siteInput = z.object({
  name: trimmed(100),
  address: optionalTrimmed(240),
});

const nzbnInput = z.union([z.literal(""), z.string().regex(/^\d{13}$/)]).default("");

export const businessInput = z.object({
  name: trimmed(100),
  nzbn: nzbnInput,
  address: optionalTrimmed(240),
  contactEmail: z.email().max(254),
  contactPhone: optionalTrimmed(40),
  timezone: z.literal("Pacific/Auckland"),
  currency: z.literal("NZD"),
  weekStart: z.literal("monday"),
});

const optionalText = (max: number) => z.string().trim().max(max).optional();
const gstNumberInput = z.string().trim().max(20).transform(gstNumberDigits).pipe(
  z.union([z.literal(""), z.string().regex(/^\d{8,9}$/)]),
).optional();
const startDateInput = z.union([
  z.literal("").transform(() => null),
  z.string().refine(isIsoDate, "Invalid start date"),
  z.null(),
]).optional();

export const contractorInput = z.object({
  name: trimmed(100),
  email: z.union([z.literal(""), z.email().max(254)]).default(""),
  phone: optionalTrimmed(40),
  defaultRateCents: rateCents,
  preferredName: optionalText(100),
  startDate: startDateInput,
  engagementStatus: z.enum(ENGAGEMENT_STATUSES).optional(),
  gstRegistered: z.boolean().optional(),
  gstNumber: gstNumberInput,
  internalNotes: optionalText(2000),
  emergencyContactName: optionalText(100),
  emergencyContactPhone: optionalText(40),
});

const contractorFieldMessages: Record<string, string> = {
  name: "Enter a name between 1 and 100 characters.",
  email: "Enter a valid email or leave it blank.",
  phone: "Phone must be at most 40 characters.",
  defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250).",
  preferredName: "Preferred name must be at most 100 characters.",
  startDate: "Start date must be a real date (YYYY-MM-DD), or blank.",
  engagementStatus: "Engagement status must be draft, invited, active, suspended, or archived.",
  gstRegistered: "GST registered must be yes or no.",
  gstNumber: "GST number must be 8 or 9 digits, or blank.",
  internalNotes: "Internal notes must be at most 2000 characters.",
  emergencyContactName: "Emergency contact name must be at most 100 characters.",
  emergencyContactPhone: "Emergency contact phone must be at most 40 characters.",
};

export function invalidRequestFromZod(error: { issues: ReadonlyArray<{ path: readonly PropertyKey[] }> }): {
  error: "invalid_request";
  fields?: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key !== "string" || !(key in contractorFieldMessages) || fields[key]) continue;
    fields[key] = contractorFieldMessages[key];
  }
  if (Object.keys(fields).length === 0) return { error: "invalid_request" };
  return { error: "invalid_request", fields };
}

export const assignmentInput = z.object({
  contractorId: trimmed(64),
  siteId: trimmed(64),
  rateCents: rateCents.nullable().default(null),
});

export const assignmentRateInput = z.object({
  rateCents: rateCents.nullable(),
});

const timeEntryIds = {
  contractorId: trimmed(64),
  siteId: trimmed(64),
  workDate: z.string().refine(isIsoDate, "Invalid work date"),
  notes: optionalTrimmed(500),
};

const clockEntryFields = {
  entryMode: z.literal("clock"),
  startMinutes: z.number().int().min(0).max(1438),
  endMinutes: z.number().int().min(1).max(1439),
  breakMinutes: z.number().int().min(0).max(720),
};

const paidHoursEntryFields = {
  entryMode: z.literal("paid_hours"),
  paidMinutes: z.number().int().min(1).max(1439),
};

const assignSite = {
  assignSite: z.object({
    rateCents: rateCents.nullable().default(null),
  }).optional(),
};

export const timeEntryInput = z.discriminatedUnion("entryMode", [
  z.object({ ...clockEntryFields, ...timeEntryIds, ...assignSite }),
  z.object({ ...paidHoursEntryFields, ...timeEntryIds, ...assignSite }),
]);

export const timeEntryUpdateInput = z.discriminatedUnion("entryMode", [
  z.object({ ...clockEntryFields, ...timeEntryIds }),
  z.object({ ...paidHoursEntryFields, ...timeEntryIds }),
]);

export const weekStartInput = z.string().refine(isMonday, "Week must start on Monday");

export const weekApproveInput = z.object({
  weekStart: weekStartInput,
  expectedPaidMinutes: z.number().int().min(0),
  expectedPayCents: z.number().int().min(0),
});

export const weekReopenInput = z.object({
  weekStart: weekStartInput,
});

export const weekApplyScheduleInput = z.object({
  weekStart: weekStartInput,
});

export const scheduleDeleteInput = z.object({
  weekStart: weekStartInput,
});

export const schedulePutInput = z.object({
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).refine((days) => new Set(days).size === days.length),
  paidMinutes: z.number().int().min(1).max(1439),
  weekStart: weekStartInput,
  fromDate: z.string().refine(isIsoDate).optional(),
  mode: z.enum(["create", "going_forward"]),
});

export const occurrenceExceptionInput = z.object({
  kind: z.enum(["absent", "worked_as_scheduled", "hours_override"]),
  paidMinutes: z.number().int().min(1).max(1439).optional(),
  scope: z.enum(["this_day", "going_forward"]),
}).refine((value) => {
  if (value.kind === "hours_override" && value.paidMinutes == null) return false;
  if (value.scope === "going_forward" && value.kind !== "hours_override") return false;
  if ((value.kind === "absent" || value.kind === "worked_as_scheduled") && value.scope !== "this_day") return false;
  return true;
});

export function parseIncludeArchived(value: string | null): boolean {
  return value === "1";
}
