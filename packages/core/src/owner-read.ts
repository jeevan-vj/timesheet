import { z } from "zod";
import { ENGAGEMENT_STATUSES, type EngagementStatus } from "./engagement";
import { isIsoDate, isMonday, weekEnd } from "./payroll";
import { dateIsoWeekday, eachDate, tasksForShifts } from "./portal";

// Mobile reads rows that already exist. It does not insert scheduled time entries.
export const OWNER_SCHEDULE_NOTE = "Scheduled shifts appear after the week is opened on the web";

const minuteOfDay = z.number().int().min(0).max(1_439);
const entryMode = z.enum(["clock", "paid_hours", "absent"]);
const occurrenceKind = z.enum(["manual", "scheduled", "worked", "absent", "hours_override"]);
const approvalStatus = z.enum(["open", "approved", "reopened"]);
const invitationState = z.enum(["none", "pending", "expired", "accepted", "revoked"]);
const invitationDelivery = z.enum(["email", "link_only", "email_failed"]);

export const ownerBusinessSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  nzbn: z.string(),
  address: z.string(),
  contactEmail: z.string(),
  contactPhone: z.string(),
  timezone: z.string().min(1),
  currency: z.literal("NZD"),
  weekStart: z.literal("monday"),
  onboardingCompletedAt: z.string().nullable(),
});

export const ownerScheduleSchema = z.object({
  id: z.string().min(1),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).refine((days) => new Set(days).size === days.length),
  paidMinutes: z.number().int().min(1).max(1_439),
  effectiveFrom: z.string().refine(isIsoDate),
});

export const ownerDashboardSiteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  address: z.string(),
});

export const ownerDashboardContractorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  defaultRateCents: z.number().int().min(0),
  currency: z.literal("NZD"),
});

export const ownerAssignmentSchema = z.object({
  id: z.string().min(1),
  contractorId: z.string().min(1),
  siteId: z.string().min(1),
  rateCents: z.number().int().min(0).nullable(),
  schedule: ownerScheduleSchema.nullable(),
});

export const ownerEntrySchema = z.object({
  id: z.string().min(1),
  contractorId: z.string().min(1),
  contractorName: z.string(),
  siteId: z.string().min(1),
  siteName: z.string(),
  workDate: z.string().refine(isIsoDate),
  startMinutes: minuteOfDay,
  endMinutes: minuteOfDay,
  breakMinutes: minuteOfDay,
  paidMinutes: minuteOfDay,
  rateCents: z.number().int().min(0),
  notes: z.string(),
  entryMode,
  occurrenceKind,
  scheduleVersionId: z.string().nullable(),
});

export const ownerSummarySchema = z.object({
  contractorId: z.string().min(1),
  contractorName: z.string(),
  paidMinutes: z.number().int().min(0),
  payCents: z.number().int().min(0),
});

export const ownerApprovalSchema = z.object({
  status: approvalStatus,
  approvedAt: z.string().nullable(),
  reopenedAt: z.string().nullable(),
});

export const ownerDashboardSchema = z.object({
  weekStart: z.string().refine(isMonday),
  weekEnd: z.string().refine(isIsoDate),
  sites: z.array(ownerDashboardSiteSchema),
  contractors: z.array(ownerDashboardContractorSchema),
  assignments: z.array(ownerAssignmentSchema),
  entries: z.array(ownerEntrySchema),
  summary: z.array(ownerSummarySchema),
  approval: ownerApprovalSchema,
  business: ownerBusinessSchema.nullable(),
}).refine((value) => {
  if (!isMonday(value.weekStart)) return false;
  return value.weekEnd === weekEnd(value.weekStart);
});

export const ownerContractorSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  defaultRateCents: z.number().int().min(0),
  currency: z.literal("NZD"),
  active: z.boolean(),
  preferredName: z.string(),
  startDate: z.string().nullable(),
  engagementStatus: z.enum(ENGAGEMENT_STATUSES),
  gstRegistered: z.boolean(),
  gstNumber: z.string(),
  internalNotes: z.string(),
  emergencyContactName: z.string(),
  emergencyContactPhone: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ownerContractorsSchema = z.object({
  contractors: z.array(ownerContractorSchema),
});

export const ownerInvitationSchema = z.object({
  state: invitationState,
  expiresAt: z.string().nullable(),
  sendCount: z.number().int().min(0).nullable(),
  lastDelivery: invitationDelivery.nullable(),
}).strict();

export const ownerSiteSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  address: z.string(),
  active: z.boolean(),
  updatedAt: z.string().min(1),
});

export const ownerSitesSchema = z.array(ownerSiteSchema);

export const ownerMeSchema = z.object({
  owner: ownerBusinessSchema.nullable(),
  contractorOf: z.array(z.object({
    businessId: z.string().min(1),
    businessName: z.string(),
  })),
});

export type OwnerBusiness = z.infer<typeof ownerBusinessSchema>;
export type OwnerDashboard = z.infer<typeof ownerDashboardSchema>;
export type OwnerEntry = z.infer<typeof ownerEntrySchema>;
export type OwnerSummary = z.infer<typeof ownerSummarySchema>;
export type OwnerContractor = z.infer<typeof ownerContractorSchema>;
export type OwnerInvitation = z.infer<typeof ownerInvitationSchema>;
export type OwnerSite = z.infer<typeof ownerSiteSchema>;
export type OwnerMe = z.infer<typeof ownerMeSchema>;
export type OwnerApprovalStatus = z.infer<typeof approvalStatus>;

export type OwnerTask = {
  id: string;
  title: string;
  detail: string;
};

export type OwnerApprovalLabel = "Open" | "Approved" | "Reopened";

const ENGAGEMENT_LABELS: Record<EngagementStatus, string> = {
  draft: "Draft",
  invited: "Invited",
  active: "Active",
  suspended: "Suspended",
  archived: "Archived",
};

export function ownerSetupIncomplete(business: OwnerBusiness | null): business is null {
  return business == null;
}

export function ownerApprovalLabel(status: OwnerApprovalStatus): OwnerApprovalLabel {
  if (status === "approved") return "Approved";
  if (status === "reopened") return "Reopened";
  return "Open";
}

export function ownerEngagementLabel(status: EngagementStatus): string {
  return ENGAGEMENT_LABELS[status];
}

export function ownerInvitationLabel(state: OwnerInvitation["state"]): string {
  if (state === "none") return "No invitation";
  if (state === "pending") return "Invitation pending";
  if (state === "expired") return "Invitation expired";
  if (state === "accepted") return "Invitation accepted";
  return "Invitation revoked";
}

export function ownerWeekTotals(summary: readonly { paidMinutes: number; payCents: number }[]): {
  paidMinutes: number;
  payCents: number;
} {
  return summary.reduce((total, row) => ({
    paidMinutes: total.paidMinutes + row.paidMinutes,
    payCents: total.payCents + row.payCents,
  }), { paidMinutes: 0, payCents: 0 });
}

export function ownerEntriesOnDate<T extends { workDate: string; startMinutes: number; siteName: string; id: string }>(
  entries: readonly T[],
  date: string,
): T[] {
  if (!isIsoDate(date)) throw new Error("invalid_request");
  return entries
    .filter((entry) => entry.workDate === date)
    .sort((a, b) => a.startMinutes - b.startMinutes || a.siteName.localeCompare(b.siteName) || a.id.localeCompare(b.id));
}

export function ownerEntriesByContractor<T extends { contractorId: string; contractorName: string }>(
  entries: readonly T[],
): { contractorId: string; contractorName: string; entries: T[] }[] {
  const groups = new Map<string, { contractorId: string; contractorName: string; entries: T[] }>();
  for (const entry of entries) {
    const current = groups.get(entry.contractorId) ?? {
      contractorId: entry.contractorId,
      contractorName: entry.contractorName,
      entries: [],
    };
    current.entries.push(entry);
    groups.set(entry.contractorId, current);
  }
  return [...groups.values()].sort((a, b) => a.contractorName.localeCompare(b.contractorName) || a.contractorId.localeCompare(b.contractorId));
}

export function ownerTasks(input: {
  entries: readonly { occurrenceKind: string }[];
  approvalStatus: OwnerApprovalStatus;
  scheduleNote?: string | null;
  weekEntries?: readonly { occurrenceKind: string }[];
}): OwnerTask[] {
  const tasks: OwnerTask[] = tasksForShifts(input.entries).map((task) => ({
    id: task.id,
    title: task.title,
    detail: "Scheduled and not marked worked yet.",
  }));
  const week = input.weekEntries ?? input.entries;
  const weekPending = week.some((entry) => entry.occurrenceKind === "scheduled");
  if (input.scheduleNote == null && !weekPending && week.length > 0 && input.approvalStatus !== "approved") {
    tasks.push({
      id: "week-ready",
      title: "Week ready to approve",
      detail: "Review the totals in Week or Payroll before approving.",
    });
  }
  return tasks;
}

type ScheduleGap = {
  weekStart: string;
  weekEnd: string;
  approvalStatus: OwnerApprovalStatus;
  assignments: readonly {
    contractorId: string;
    siteId: string;
    schedule: { weekdays: readonly number[]; effectiveFrom: string } | null;
  }[];
  entries: readonly { contractorId: string; siteId: string; workDate: string }[];
};

function entryKey(contractorId: string, siteId: string, workDate: string): string {
  return `${contractorId}\u0000${siteId}\u0000${workDate}`;
}

export function ownerScheduleNote(input: ScheduleGap): string | null {
  if (input.approvalStatus === "approved") return null;
  const present = new Set(input.entries.map((entry) => entryKey(entry.contractorId, entry.siteId, entry.workDate)));
  for (const day of eachDate(input.weekStart, input.weekEnd)) {
    const weekday = dateIsoWeekday(day);
    for (const assignment of input.assignments) {
      const schedule = assignment.schedule;
      if (!schedule || day < schedule.effectiveFrom || !schedule.weekdays.includes(weekday)) continue;
      if (!present.has(entryKey(assignment.contractorId, assignment.siteId, day))) return OWNER_SCHEDULE_NOTE;
    }
  }
  return null;
}
