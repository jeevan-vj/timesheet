import { describe, expect, it } from "vitest";
import { calculateEntryPayCents } from "../src/lib/payroll.ts";
import { entryPayCents, syntheticRoster } from "./e2e/payroll-fixture.mjs";

describe("verify-e2e payroll fixture", () => {
  const roster = syntheticRoster("fixture");

  it("uses the same per-entry cent rounding as calculateEntryPayCents", () => {
    for (const contractor of roster.contractors) {
      expect(entryPayCents(contractor.paidMinutesEach, contractor.snapshotRateCents)).toBe(
        calculateEntryPayCents(contractor.paidMinutesEach, contractor.snapshotRateCents),
      );
    }
  });

  it("keeps four contractors, three sites, and integer week totals", () => {
    expect(roster.sites).toHaveLength(3);
    expect(roster.contractors).toHaveLength(4);
    expect(roster.totals).toEqual({ paidMinutes: 885, payCents: 47175, entries: 5 });
    expect(roster.siteTotals).toEqual([
      { name: "Airport Lounge", paidMinutes: 270, payCents: 18000 },
      { name: "Civic Tower", paidMinutes: 195, payCents: 11375 },
      { name: "Harbour Wharf", paidMinutes: 420, payCents: 17800 },
    ]);
    const ben = roster.contractors.find((contractor) => contractor.name === "Ben Test");
    expect(ben?.defaultRateCents).toBe(3250);
    expect(ben?.snapshotRateCents).toBe(3500);
    expect(roster.siteTotals.reduce((sum, site) => sum + site.payCents, 0)).toBe(roster.totals.payCents);
    expect(roster.siteTotals.reduce((sum, site) => sum + site.paidMinutes, 0)).toBe(roster.totals.paidMinutes);
  });
});
