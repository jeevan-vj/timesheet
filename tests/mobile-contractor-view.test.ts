import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PORTAL_REMITTANCE_AVAILABLE } from "@cleantrack/core/portal";
import { roleLabel } from "../apps/mobile/src/api-config";
import {
  accountWebUrl,
  collapseEmptyDays,
  emptySpanLabel,
  formatAppBuild,
  isCurrentWeek,
  payWeekRows,
  weekDayProgress,
  weekIncludesDate,
} from "../apps/mobile/src/contractor-view";
import { readViewerProfile } from "../apps/mobile/src/me-response";

const WEEK = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"] as const;

function day(date: string, shiftIds: string[] = []) {
  return { date, shifts: shiftIds.map((id) => ({ id })) };
}

describe("empty day collapsing", () => {
  it("collapses consecutive empty days and keeps today on its own row", () => {
    const days = WEEK.map((date, index) => day(date, index === 4 ? ["fri"] : []));
    expect(collapseEmptyDays(days, "2026-10-28")).toEqual([
      { kind: "empty", from: "2026-10-26", to: "2026-10-27" },
      { kind: "day", day: days[2], isToday: true },
      { kind: "empty", from: "2026-10-29", to: "2026-10-29" },
      { kind: "day", day: days[4], isToday: false },
      { kind: "empty", from: "2026-10-31", to: "2026-11-01" },
    ]);
  });

  it("leaves a day with shifts uncollapsed, including today", () => {
    const days = [day("2026-10-26", ["mon"]), day("2026-10-27")];
    expect(collapseEmptyDays(days, "2026-10-26")).toEqual([
      { kind: "day", day: days[0], isToday: true },
      { kind: "empty", from: "2026-10-27", to: "2026-10-27" },
    ]);
  });

  it("labels a single empty day and a run of empty days", () => {
    expect(emptySpanLabel("2026-10-26", "2026-10-26")).toBe("Mon 26 Oct, no shifts");
    expect(emptySpanLabel("2026-10-26", "2026-10-28")).toBe("Mon 26 Oct – Wed 28 Oct, no shifts");
  });
});

describe("week progress", () => {
  it("knows the current week and how far through it today is", () => {
    expect(isCurrentWeek("2026-10-26", "2026-10-28")).toBe(true);
    expect(isCurrentWeek("2026-10-19", "2026-10-28")).toBe(false);
    expect(isCurrentWeek("2026-10-26", "not-a-date")).toBe(false);
    expect(weekIncludesDate("2026-10-26", "2026-11-01")).toBe(true);
    expect(weekIncludesDate("2026-10-26", "2026-11-02")).toBe(false);
    expect(weekDayProgress("2026-10-26", "2026-10-25")).toEqual({ value: 0, label: "This week has not started" });
    expect(weekDayProgress("2026-10-26", "2026-10-26")).toEqual({ value: 1 / 7, label: "Day 1 of 7" });
    expect(weekDayProgress("2026-10-26", "2026-10-28")).toEqual({ value: 3 / 7, label: "Day 3 of 7" });
    expect(weekDayProgress("2026-10-26", "2026-11-01")).toEqual({ value: 1, label: "Day 7 of 7" });
    expect(weekDayProgress("2026-10-26", "2026-11-02")).toEqual({ value: 1, label: "This week is complete" });
    expect(weekDayProgress("Tuesday", "2026-10-28")).toEqual({ value: 0, label: "Week progress unavailable" });
  });
});

describe("pay week rows", () => {
  const approved = { weekStart: "2026-10-19", weekEnd: "2026-10-25", paidMinutes: 120, payCents: 6400 };
  const headline = { weekStart: "2026-10-26", weekEnd: "2026-11-01", paidMinutes: 60, payCents: 3200, estimated: true };

  it("sums approved cents and minutes and keeps an estimated week out of that total", () => {
    const summary = payWeekRows({ headline, weeks: [approved] });
    expect(summary.approvedCents).toBe(6400);
    expect(summary.approvedMinutes).toBe(120);
    expect(summary.rows.map((row) => row.status)).toEqual(["Estimated", "Approved"]);
    expect(summary.rows[0]).toMatchObject({ weekStart: "2026-10-26", payCents: 3200, status: "Estimated" });
  });

  it("does not duplicate a headline week that is already approved", () => {
    const summary = payWeekRows({
      headline: { ...approved, estimated: false },
      weeks: [approved],
    });
    expect(summary.rows).toEqual([{ ...approved, status: "Approved" }]);
    expect(summary.approvedCents).toBe(6400);
  });
});

describe("account labels", () => {
  it("formats the installed version and update channel", () => {
    expect(formatAppBuild("0.1.0", null)).toBe("Version 0.1.0");
    expect(formatAppBuild("  ", "  ")).toBe("Version 0.1.0");
    expect(formatAppBuild("0.1.0", "preview")).toBe("Version 0.1.0 · preview");
  });

  it("opens password reset and help on existing website paths", () => {
    expect(accountWebUrl("https://example.test", "resetPassword")).toBe("https://example.test/sign-in");
    expect(accountWebUrl("https://example.test/", "help")).toBe("https://example.test/");
  });

  it("labels a contractor from contractorOf instead of the owner role", () => {
    const link = { businessId: "biz_1", businessName: "Northwind" };
    const contractor = readViewerProfile({ owner: null, contractorOf: [link] });
    const both = readViewerProfile({ owner: { id: "biz_1" }, contractorOf: [link] });
    expect(contractor).toEqual({ role: "contractor", contractorOf: [link] });
    expect(roleLabel(contractor?.role ?? "none")).toBe("Contractor");
    expect(roleLabel(both?.role ?? "none")).toBe("Owner and contractor");
  });
});

describe("contractor screens stay read-only", () => {
  const screens = [
    "apps/mobile/src/app/(contractor)/(tabs)/week.tsx",
    "apps/mobile/src/app/(contractor)/(tabs)/pay.tsx",
    "apps/mobile/src/app/(contractor)/(tabs)/account.tsx",
    "apps/mobile/src/app/(contractor)/upcoming.tsx",
    "apps/mobile/src/components/shift-list.tsx",
    "apps/mobile/src/components/shift-sheet.tsx",
  ];

  it("does not apply a schedule or call the owner remittance route", () => {
    for (const file of screens) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("apply-schedule");
      expect(source, file).not.toContain("/api/contractors/");
    }
  });

  it("offers the contractor-scoped PDF action inside approved week detail", () => {
    const pay = readFileSync("apps/mobile/src/app/(contractor)/(tabs)/pay.tsx", "utf8");
    expect(PORTAL_REMITTANCE_AVAILABLE).toBe(true);
    expect(pay).toContain("PORTAL_REMITTANCE_AVAILABLE");
    expect(pay).toContain("ContractorRemittanceActions");
    expect(pay).not.toContain("Remittance PDFs stay on the website.");
    expect(pay).not.toContain("View on web");
    expect(readFileSync("apps/mobile/src/contractor-remittance.ts", "utf8")).not.toContain("/api/contractors/");
    expect(pay).toContain("<Sheet");
    expect(readFileSync("apps/mobile/src/ui/sheet.tsx", "utf8")).toContain('presentationStyle="pageSheet"');
  });

  it("uses the viewer role label and confirms before sign out", () => {
    const account = readFileSync("apps/mobile/src/app/(contractor)/(tabs)/account.tsx", "utf8");
    expect(account).toContain("viewer.label");
    expect(account).toContain("Sign out?");
    expect(account).toContain("contractorOf");
    expect(account).not.toContain(">Owner<");
  });

  it("uses the native upcoming header instead of a text back button", () => {
    const upcoming = readFileSync("apps/mobile/src/app/(contractor)/upcoming.tsx", "utf8");
    const layout = readFileSync("apps/mobile/src/app/(contractor)/_layout.tsx", "utf8");
    expect(upcoming).not.toContain('accessibilityLabel="Back"');
    expect(layout).toContain('title: "Upcoming"');
    expect(layout).toContain("headerShown: true");
  });
});
