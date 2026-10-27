import { describe, expect, it } from "vitest";
import {
  PORTAL_REMITTANCE_AVAILABLE,
  addDaysIso,
  directionsUrl,
  formatShiftTime,
  offlineBannerText,
  portalPaymentsSchema,
  portalQueryPersists,
  portalShiftSchema,
  portalWeekSchema,
  selectNextJob,
  shiftWeek,
  spokenNzd,
  tasksForShifts,
  upcomingRange,
  weekdayMatchesMask,
  type PortalShift,
} from "@cleantrack/core/portal";

function shift(partial: Partial<PortalShift> & Pick<PortalShift, "id" | "workDate">): PortalShift {
  return {
    businessId: "biz",
    businessName: "Northwind",
    siteName: "Queen Street",
    address: "12 Queen Street",
    paidMinutes: 60,
    entryMode: "paid_hours",
    occurrenceKind: "scheduled",
    startMinutes: null,
    endMinutes: null,
    breakMinutes: null,
    ...partial,
  };
}

describe("contractor portal view", () => {
  it("keeps pay queries out of the persisted cache", () => {
    expect(portalQueryPersists(["portal-week", "2026-10-26"])).toBe(true);
    expect(portalQueryPersists(["portal-upcoming"])).toBe(true);
    expect(portalQueryPersists(["portal-payments", "2026-10-26"])).toBe(false);
    expect(portalQueryPersists(["portal-payment", "2026-10-19"])).toBe(false);
    expect(portalQueryPersists(["viewer"])).toBe(false);
  });

  it("leaves remittance download unavailable", () => {
    expect(PORTAL_REMITTANCE_AVAILABLE).toBe(false);
  });

  it("rejects notes, rates, and pay on a week shift", () => {
    const parsed = portalShiftSchema.safeParse({
      id: "entry-1",
      businessId: "biz",
      businessName: "Northwind",
      siteName: "Queen Street",
      address: "12 Queen Street",
      workDate: "2026-10-27",
      paidMinutes: 180,
      entryMode: "clock",
      occurrenceKind: "worked",
      startMinutes: 540,
      endMinutes: 720,
      breakMinutes: 0,
      notes: "owner note",
      rateCents: 3200,
      payCents: 9600,
    });
    expect(parsed.success).toBe(false);
    expect(portalWeekSchema.safeParse({
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      days: [],
      tasks: [],
      payCents: 1,
    }).success).toBe(false);
    expect(portalPaymentsSchema.safeParse({
      headline: {
        weekStart: "2026-10-26",
        weekEnd: "2026-11-01",
        paidMinutes: 180,
        payCents: 9600,
        estimated: true,
      },
      weeks: [],
    }).success).toBe(true);
  });

  it("picks the next job and skips earlier or absent shifts", () => {
    const next = selectNextJob([
      shift({ id: "old", workDate: "2026-10-26", siteName: "Old" }),
      shift({ id: "absent", workDate: "2026-10-27", occurrenceKind: "absent", entryMode: "absent", paidMinutes: 0 }),
      shift({ id: "later", workDate: "2026-10-27", startMinutes: 780, endMinutes: 900, entryMode: "clock", siteName: "Later" }),
      shift({ id: "soon", workDate: "2026-10-27", startMinutes: 540, endMinutes: 720, entryMode: "clock", siteName: "Soon" }),
    ], "2026-10-27");
    expect(next?.id).toBe("soon");
  });

  it("describes clock time without turning paid hours into midnight", () => {
    expect(formatShiftTime(shift({
      id: "clock",
      workDate: "2026-10-27",
      entryMode: "clock",
      occurrenceKind: "worked",
      startMinutes: 540,
      endMinutes: 750,
      breakMinutes: 15,
      paidMinutes: 195,
    }))).toBe("9:00 am – 12:30 pm, 15 min break");
    expect(formatShiftTime(shift({ id: "hours", workDate: "2026-10-28", paidMinutes: 60 }))).toBe("1h 00m");
  });

  it("builds tasks only when a shift is still pending", () => {
    expect(tasksForShifts([shift({ id: "a", workDate: "2026-10-27", occurrenceKind: "worked" })])).toEqual([]);
    expect(tasksForShifts([
      shift({ id: "a", workDate: "2026-10-27" }),
      shift({ id: "b", workDate: "2026-10-28" }),
    ])).toEqual([{
      id: "pending-shifts",
      title: "2 shifts still pending",
      detail: "These are on your schedule and not marked worked yet.",
    }]);
  });

  it("speaks money and keeps the offline banner free of amounts", () => {
    expect(spokenNzd(12000)).toBe("one hundred twenty dollars");
    expect(spokenNzd(1)).toBe("zero dollars and one cent");
    expect(offlineBannerText(Date.UTC(2026, 9, 27, 21, 42))).toMatch(/^Offline\. Last updated /);
    expect(offlineBannerText(null)).toBe("Offline. Last updated time is not saved yet.");
  });

  it("limits upcoming to 14 days and steps weeks by Monday", () => {
    expect(upcomingRange("2026-10-27")).toEqual({ from: "2026-10-27", to: "2026-11-09" });
    expect(() => upcomingRange("2026-10-27", 15)).toThrow("invalid_request");
    expect(shiftWeek("2026-10-26", 1)).toBe("2026-11-02");
    expect(shiftWeek("2026-10-26", -1)).toBe("2026-10-19");
    expect(addDaysIso("2026-10-27", 13)).toBe("2026-11-09");
    expect(weekdayMatchesMask(31, 1)).toBe(true);
    expect(weekdayMatchesMask(31, 6)).toBe(false);
  });

  it("builds a maps link from the site address", () => {
    expect(directionsUrl("  12 Queen Street  ", "ios")).toBe("https://maps.apple.com/?daddr=12%20Queen%20Street");
    expect(directionsUrl("12 Queen Street", "android")).toContain("google.com/maps");
    expect(directionsUrl("   ", "web")).toBeNull();
  });
});
