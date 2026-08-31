import { describe, expect, it } from "vitest";
import { calculateEntryPayCents, calculatePaidMinutes, isMonday, paidMinutesFromParts, summarizeWeek } from "../src/lib/payroll";

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
});
