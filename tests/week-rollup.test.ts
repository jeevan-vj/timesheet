import { describe, expect, it } from "vitest";
import { calculateEntryPayCents, summarizeWeek } from "../src/lib/payroll";
import { formatWeekBrief, summarizeWeekBySite } from "../src/lib/week-rollup";

const entries = [
  { contractorId: "c1", contractorName: "Aroha", siteId: "s1", siteName: "Depot", paidMinutes: 120, rateCents: 3_000 },
  { contractorId: "c1", contractorName: "Aroha", siteId: "s2", siteName: "Civic", paidMinutes: 90, rateCents: 3_200 },
  { contractorId: "c2", contractorName: "Mika", siteId: "s1", siteName: "Depot", paidMinutes: 60, rateCents: 2_800 },
  { contractorId: "c1", contractorName: "Aroha", siteId: "s1", siteName: "Depot", paidMinutes: 0, rateCents: 3_000 },
];

describe("site week rollup", () => {
  it("groups snapshotted entry pay by site and skips pay math on zero-minute rows", () => {
    expect(summarizeWeekBySite(entries)).toEqual([
      { siteId: "s2", siteName: "Civic", paidMinutes: 90, payCents: calculateEntryPayCents(90, 3_200) },
      {
        siteId: "s1",
        siteName: "Depot",
        paidMinutes: 180,
        payCents: calculateEntryPayCents(120, 3_000) + calculateEntryPayCents(60, 2_800),
      },
    ]);
  });

  it("keeps site pay equal to the contractor summary for the same entries", () => {
    const bySite = summarizeWeekBySite(entries);
    const byContractor = summarizeWeek(entries);
    const sitePay = bySite.reduce((sum, row) => sum + row.payCents, 0);
    const contractorPay = byContractor.reduce((sum, row) => sum + row.payCents, 0);
    const siteMinutes = bySite.reduce((sum, row) => sum + row.paidMinutes, 0);
    const contractorMinutes = byContractor.reduce((sum, row) => sum + row.paidMinutes, 0);
    expect(sitePay).toBe(contractorPay);
    expect(siteMinutes).toBe(contractorMinutes);
  });

  it("returns an empty rollup when the week has no entries", () => {
    expect(summarizeWeekBySite([])).toEqual([]);
  });
});

describe("week brief", () => {
  it("copies contractor and site lines without rates, notes, or contact details", () => {
    const sites = summarizeWeekBySite(entries);
    const contractors = summarizeWeek(entries);
    const brief = formatWeekBrief({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-18",
      contractors: contractors.map((row) => ({ name: row.contractorName, paidMinutes: row.paidMinutes, payCents: row.payCents })),
      sites: sites.map((row) => ({ name: row.siteName, paidMinutes: row.paidMinutes, payCents: row.payCents })),
    });
    expect(brief).toBe([
      "CleanTrack week 12 Oct 2026 – 18 Oct 2026",
      "Gross contractor pay before tax, GST, expenses, or adjustments.",
      "",
      "Contractors",
      "- Aroha: 3h 30m · $108.00",
      "- Mika: 1h 00m · $28.00",
      "",
      "Sites",
      "- Civic: 1h 30m · $48.00",
      "- Depot: 3h 00m · $88.00",
      "",
      "Total: 4h 30m · $136.00",
    ].join("\n"));
    expect(brief).not.toContain("3000");
    expect(brief).not.toContain("@");
  });

  it("says the week is empty instead of inventing pay", () => {
    const brief = formatWeekBrief({ weekStart: "2026-10-12", weekEnd: "2026-10-18", contractors: [], sites: [] });
    expect(brief).toContain("No shifts this week.");
    expect(brief).toContain("Total: 0h 00m · $0.00");
  });
});
