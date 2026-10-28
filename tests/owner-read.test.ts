import { describe, expect, it } from "vitest";
import {
  OWNER_SCHEDULE_NOTE,
  eachDate,
  ownerApprovalLabel,
  ownerContractorsSchema,
  ownerContractorSchema,
  ownerDashboardSchema,
  ownerEngagementLabel,
  ownerEntriesByContractor,
  ownerEntriesOnDate,
  ownerInvitationLabel,
  ownerInvitationSchema,
  ownerMeSchema,
  ownerScheduleNote,
  ownerSetupIncomplete,
  ownerSitesSchema,
  ownerTasks,
  ownerWeekTotals,
  type OwnerDashboard,
  type OwnerEntry,
} from "@cleantrack/core";

const WEEK = "2026-10-26";
const WEEK_END = "2026-11-01";

function business() {
  return {
    id: "biz",
    name: "Northwind",
    nzbn: "",
    address: "1 Quay Street",
    contactEmail: "owner@example.com",
    contactPhone: "",
    timezone: "Pacific/Auckland",
    currency: "NZD" as const,
    weekStart: "monday" as const,
    onboardingCompletedAt: null,
  };
}

function entry(workDate: string, id = `entry-${workDate}`): OwnerEntry {
  return {
    id,
    contractorId: "contractor-1",
    contractorName: "Aroha",
    siteId: "site-1",
    siteName: "Queen Street",
    workDate,
    startMinutes: 540,
    endMinutes: 630,
    breakMinutes: 0,
    paidMinutes: 90,
    rateCents: 2_500,
    notes: "",
    entryMode: "paid_hours",
    occurrenceKind: "scheduled",
    scheduleVersionId: "schedule-1",
  };
}

function schedule(effectiveFrom = WEEK) {
  return { id: "schedule-1", weekdays: [1, 2, 3, 4, 5], paidMinutes: 90, effectiveFrom };
}

function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    weekStart: WEEK,
    weekEnd: WEEK_END,
    sites: [{ id: "site-1", name: "Queen Street", address: "12 Queen Street" }],
    contractors: [{
      id: "contractor-1",
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 2_500,
      currency: "NZD",
    }],
    assignments: [{
      id: "assignment-1",
      contractorId: "contractor-1",
      siteId: "site-1",
      rateCents: null,
      schedule: null,
    }],
    entries: [],
    summary: [],
    approval: { status: "open", approvedAt: null, reopenedAt: null },
    business: business(),
    ...overrides,
  };
}

function contractor() {
  return {
    id: "contractor-1",
    name: "Aroha",
    email: "aroha@example.com",
    phone: "",
    defaultRateCents: 2_500,
    currency: "NZD" as const,
    active: true,
    preferredName: "",
    startDate: null,
    engagementStatus: "active" as const,
    gstRegistered: false,
    gstNumber: "",
    internalNotes: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("owner read models", () => {
  it("accepts a dashboard payload and rejects writes, leaks, and bad weeks", () => {
    const parsed = ownerDashboardSchema.safeParse(dashboard());
    expect(parsed.success).toBe(true);
    expect(ownerDashboardSchema.safeParse(dashboard({ business: null })).success).toBe(true);
    expect(ownerDashboardSchema.safeParse(dashboard({ ownerUserId: "owner-a" })).success).toBe(false);
    expect(ownerDashboardSchema.safeParse(dashboard({ applySchedule: true })).success).toBe(false);
    expect(ownerDashboardSchema.safeParse(dashboard({
      summary: [{ contractorId: "contractor-1", contractorName: "Aroha", paidMinutes: 90, payCents: 10.5 }],
    })).success).toBe(false);
    expect(ownerDashboardSchema.safeParse(dashboard({ weekStart: "2026-10-27" })).success).toBe(false);
    expect(ownerDashboardSchema.safeParse(dashboard({ weekEnd: "2026-11-02" })).success).toBe(false);
    expect(ownerDashboardSchema.safeParse(dashboard({
      approval: { status: "locked", approvedAt: null, reopenedAt: null },
    })).success).toBe(false);
  });

  it("rejects malformed contractor, invitation, site, and profile payloads", () => {
    expect(ownerContractorSchema.safeParse(contractor()).success).toBe(true);
    expect(ownerContractorSchema.safeParse({ ...contractor(), ownerUserId: "owner-a" }).success).toBe(false);
    expect(ownerContractorSchema.safeParse({ ...contractor(), engagementStatus: "fired" }).success).toBe(false);
    expect(ownerContractorSchema.safeParse({ ...contractor(), createdAt: 1 }).success).toBe(false);
    expect(ownerContractorsSchema.safeParse({ contractors: [contractor()] }).success).toBe(true);
    expect(ownerContractorsSchema.safeParse([contractor()]).success).toBe(false);
    expect(ownerInvitationSchema.safeParse({
      state: "pending",
      expiresAt: "2026-11-02T00:00:00.000Z",
      sendCount: 1,
      lastDelivery: "email",
    }).success).toBe(true);
    expect(ownerInvitationSchema.safeParse({
      state: "sent",
      expiresAt: null,
      sendCount: null,
      lastDelivery: null,
    }).success).toBe(false);
    expect(ownerSitesSchema.safeParse([{
      id: "site-1",
      name: "Queen Street",
      address: "",
      active: true,
      updatedAt: "2026-10-01T00:00:00.000Z",
    }]).success).toBe(true);
    expect(ownerSitesSchema.safeParse({ sites: [] }).success).toBe(false);
    expect(ownerMeSchema.safeParse({ owner: business(), contractorOf: [] }).success).toBe(true);
    expect(ownerMeSchema.safeParse({ contractorOf: [] }).success).toBe(false);
    expect(ownerMeSchema.safeParse({ owner: { ...business(), currency: "AUD" }, contractorOf: [] }).success).toBe(false);
  });

  it("shows the schedule note only when an unapproved week is missing a scheduled row", () => {
    const weekdays = eachDate(WEEK, "2026-10-30");
    const filled = weekdays.map((day) => entry(day));
    const gap = {
      weekStart: WEEK,
      weekEnd: WEEK_END,
      assignments: [{ contractorId: "contractor-1", siteId: "site-1", schedule: schedule() }],
      entries: filled.slice(0, 4),
    };
    expect(ownerScheduleNote({ ...gap, approvalStatus: "open" })).toBe(OWNER_SCHEDULE_NOTE);
    expect(ownerScheduleNote({ ...gap, approvalStatus: "reopened" })).toBe(OWNER_SCHEDULE_NOTE);
    expect(ownerScheduleNote({ ...gap, entries: filled, approvalStatus: "open" })).toBeNull();
    expect(ownerScheduleNote({ ...gap, approvalStatus: "approved" })).toBeNull();
    expect(ownerScheduleNote({
      ...gap,
      assignments: [{ contractorId: "contractor-1", siteId: "site-1", schedule: null }],
      approvalStatus: "open",
    })).toBeNull();
    expect(ownerScheduleNote({
      ...gap,
      entries: [],
      assignments: [{ contractorId: "contractor-1", siteId: "site-1", schedule: schedule("2026-10-28") }],
      approvalStatus: "open",
    })).toBe(OWNER_SCHEDULE_NOTE);
    expect(ownerScheduleNote({
      ...gap,
      entries: ["2026-10-28", "2026-10-29", "2026-10-30"].map((day) => entry(day)),
      assignments: [{ contractorId: "contractor-1", siteId: "site-1", schedule: schedule("2026-10-28") }],
      approvalStatus: "open",
    })).toBeNull();
  });

  it("builds today rows, contractor groups, tasks, and server summary totals", () => {
    const monday = entry(WEEK, "mon");
    const later = { ...entry("2026-10-27", "tue"), startMinutes: 480, contractorId: "contractor-2", contractorName: "Bea" };
    expect(ownerEntriesOnDate([later, monday, { ...monday, id: "other-week", workDate: "2026-10-28" }], "2026-10-27").map((row) => row.id)).toEqual(["tue"]);
    expect(ownerEntriesByContractor([later, monday]).map((group) => group.contractorName)).toEqual(["Aroha", "Bea"]);
    expect(ownerTasks({ entries: [monday, later], approvalStatus: "open" }).map((task) => task.title)).toEqual(["2 shifts still pending"]);
    expect(ownerTasks({ entries: [{ ...monday, occurrenceKind: "worked" }], approvalStatus: "open" })).toEqual([{
      id: "week-ready",
      title: "Week ready to approve",
      detail: "Approval stays on the web for now.",
    }]);
    expect(ownerTasks({ entries: [{ ...monday, occurrenceKind: "worked" }], approvalStatus: "approved" })).toEqual([]);
    expect(ownerTasks({ entries: [], approvalStatus: "open" })).toEqual([]);
    expect(ownerWeekTotals([
      { paidMinutes: 90, payCents: 3_750 },
      { paidMinutes: 30, payCents: 1_250 },
    ])).toEqual({ paidMinutes: 120, payCents: 5_000 });
    expect(ownerWeekTotals([])).toEqual({ paidMinutes: 0, payCents: 0 });
  });

  it("labels approval, engagement, and invitation without treating a missing business as ready", () => {
    expect(ownerApprovalLabel("open")).toBe("Open");
    expect(ownerApprovalLabel("approved")).toBe("Approved");
    expect(ownerApprovalLabel("reopened")).toBe("Reopened");
    expect(ownerEngagementLabel("active")).toBe("Active");
    expect(ownerInvitationLabel("none")).toBe("No invitation");
    expect(ownerInvitationLabel("pending")).toBe("Invitation pending");
    const parsed = ownerDashboardSchema.parse(dashboard({ business: null })) as OwnerDashboard;
    expect(ownerSetupIncomplete(parsed.business)).toBe(true);
    expect(ownerSetupIncomplete(business())).toBe(false);
  });
});
