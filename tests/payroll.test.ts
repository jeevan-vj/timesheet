import { describe, expect, it } from "vitest";
import { calculateEntryPayCents, calculatePaidMinutes, isMonday, paidMinutesFromParts, summarizeWeek, weekStartForDate, weekTotals } from "../src/lib/payroll";

describe("payroll calculations", () => {
  it("subtracts an unpaid break from a same-day shift", () => {
    expect(calculatePaidMinutes(8 * 60, 16 * 60 + 30, 30)).toBe(480);
  });

  it("rejects zero, negative, and break-consuming durations", () => {
    expect(() => calculatePaidMinutes(600, 600, 0)).toThrow("invalid_shift");
    expect(() => calculatePaidMinutes(600, 540, 0)).toThrow("invalid_shift");
    expect(() => calculatePaidMinutes(600, 660, 60)).toThrow("invalid_shift");
  });

  it("converts paid hours plus minutes into integer minutes", () => {
    expect(paidMinutesFromParts(8, 0)).toBe(480);
    expect(paidMinutesFromParts(0, 45)).toBe(45);
    expect(() => paidMinutesFromParts(0, 0)).toThrow("invalid_shift");
    expect(() => paidMinutesFromParts(24, 0)).toThrow("invalid_shift");
    expect(() => paidMinutesFromParts(8, 60)).toThrow("invalid_shift");
  });

  it("rounds each entry pay to the nearest cent", () => {
    expect(calculateEntryPayCents(95, 2_750)).toBe(4_354);
  });

  it("groups weekly pay by contractor using entry rate snapshots", () => {
    const rows = summarizeWeek([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 120, rateCents: 3_000 },
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 90, rateCents: 3_200 },
      { contractorId: "c2", contractorName: "Mika", paidMinutes: 60, rateCents: 2_800 },
    ]);
    expect(rows).toEqual([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 210, payCents: 10_800 },
      { contractorId: "c2", contractorName: "Mika", paidMinutes: 60, payCents: 2_800 },
    ]);
  });

  it("recognises ISO Mondays without timezone drift", () => {
    expect(isMonday("2026-08-31")).toBe(true);
    expect(isMonday("2026-09-01")).toBe(false);
  });

  it("returns the UTC calendar Monday for an ISO work date", () => {
    expect(weekStartForDate("2026-09-02")).toBe("2026-08-31");
    expect(weekStartForDate("2026-08-31")).toBe("2026-08-31");
    expect(weekStartForDate("2026-09-06")).toBe("2026-08-31");
    expect(weekStartForDate("2026-09-07")).toBe("2026-09-07");
  });

  it("rejects invalid ISO dates with the same week-start error as weekEnd", () => {
    expect(() => weekStartForDate("2026-13-01")).toThrow("invalid_week_start");
    expect(() => weekStartForDate("31/08/2026")).toThrow("invalid_week_start");
    expect(() => weekStartForDate("not-a-date")).toThrow("invalid_week_start");
  });

  it("summarises week totals as zero for an empty list without calling per-entry pay", () => {
    expect(weekTotals([])).toEqual({ paidMinutes: 0, payCents: 0 });
  });

  it("sums paid minutes and per-entry rounded cents the same way as summarizeWeek", () => {
    expect(weekTotals([
      { paidMinutes: 120, rateCents: 3_000 },
      { paidMinutes: 90, rateCents: 3_200 },
      { paidMinutes: 60, rateCents: 2_800 },
    ])).toEqual({ paidMinutes: 270, payCents: 13_600 });
    expect(weekTotals([
      { paidMinutes: 1, rateCents: 2_500 },
      { paidMinutes: 1, rateCents: 2_500 },
    ])).toEqual({
      paidMinutes: 2,
      payCents: calculateEntryPayCents(1, 2_500) + calculateEntryPayCents(1, 2_500),
    });
    expect(weekTotals([
      { paidMinutes: 1, rateCents: 2_500 },
      { paidMinutes: 1, rateCents: 2_500 },
    ]).payCents).not.toBe(Math.round((2 * 2_500) / 60));
  });
});
