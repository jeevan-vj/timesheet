import { describe, expect, it } from "vitest";
import { calculateEntryPayCents, calculatePaidMinutes, isMonday, paidMinutesFromParts, summarizeWeek, weekPayrollTotals, weekStartFromDate } from "../src/lib/payroll";

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

  it("maps any ISO calendar date to that week's Monday in UTC", () => {
    expect(weekStartFromDate("2026-08-31")).toBe("2026-08-31");
    expect(weekStartFromDate("2026-09-01")).toBe("2026-08-31");
    expect(weekStartFromDate("2026-09-06")).toBe("2026-08-31");
    expect(weekStartFromDate("2026-09-07")).toBe("2026-09-07");
  });

  it("rejects non-ISO dates for week identity", () => {
    expect(() => weekStartFromDate("31/08/2026")).toThrow("invalid_week_start");
    expect(() => weekStartFromDate("2026-13-01")).toThrow("invalid_week_start");
    expect(() => weekStartFromDate("")).toThrow("invalid_week_start");
  });

  it("sums owner-week paid minutes and per-entry pay without calling pay math on empty or zero-minute rows", () => {
    expect(weekPayrollTotals([])).toEqual({ currentPaidMinutes: 0, currentPayCents: 0 });
    expect(weekPayrollTotals([{ paidMinutes: 0, rateCents: 3_000 }])).toEqual({ currentPaidMinutes: 0, currentPayCents: 0 });
    expect(weekPayrollTotals([
      { paidMinutes: 120, rateCents: 3_000 },
      { paidMinutes: 90, rateCents: 3_200 },
    ])).toEqual({
      currentPaidMinutes: 210,
      currentPayCents: calculateEntryPayCents(120, 3_000) + calculateEntryPayCents(90, 3_200),
    });
  });

  it("adds 0-minute rows to summarizeWeek minutes without calling pay math", () => {
    expect(summarizeWeek([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 0, rateCents: 2_000 },
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 90, rateCents: 2_000 },
    ])).toEqual([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 90, payCents: calculateEntryPayCents(90, 2_000) },
    ]);
    expect(summarizeWeek([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 0, rateCents: 2_000 },
    ])).toEqual([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 0, payCents: 0 },
    ]);
  });
});
