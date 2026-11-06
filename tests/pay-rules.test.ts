import { describe, expect, it } from "vitest";
import {
  calculateEntryPayCents,
  calculateShiftPay,
  nzPublicHolidayDates,
  overnightOverlapMinutes,
  summarizeWeek,
} from "../src/lib/payroll";

const hourly = {
  workDate: "2026-10-26",
  paidMinutes: 240,
  rateCents: 3_200,
  startMinutes: 8 * 60,
  endMinutes: 12 * 60,
  payMode: "hourly" as const,
  fixedPayCents: null,
};

describe("optional pay rules", () => {
  it("keeps the all-off hourly path byte-identical to calculateEntryPayCents", () => {
    const result = calculateShiftPay(hourly, null, []);
    expect(result).toEqual({
      baseCents: calculateEntryPayCents(240, 3_200),
      holidayLoadingCents: 0,
      weekendLoadingCents: 0,
      overnightLoadingCents: 0,
      fixedCents: 0,
      totalCents: calculateEntryPayCents(240, 3_200),
    });
  });

  it("pays Labour Day 2026 at 1.5x", () => {
    const dates = nzPublicHolidayDates(2026).map((holiday) => holiday.date);
    expect(calculateShiftPay(hourly, { holidayMode: "multiplier", holidayMultiplierBps: 15_000 }, dates)).toEqual({
      baseCents: 12_800,
      holidayLoadingCents: 6_400,
      weekendLoadingCents: 0,
      overnightLoadingCents: 0,
      fixedCents: 0,
      totalCents: 19_200,
    });
  });

  it("includes ANZAC Day and its Mondayised 2026 date", () => {
    const dates = nzPublicHolidayDates(2026).map((holiday) => holiday.date);
    expect(dates).toContain("2026-04-25");
    expect(dates).toContain("2026-04-27");
  });

  it("includes the full required 2026 calendar", () => {
    const dates = new Set(nzPublicHolidayDates(2026).map((holiday) => holiday.date));
    for (const date of ["2026-01-01", "2026-01-02", "2026-02-06", "2026-04-03", "2026-04-06", "2026-04-25", "2026-04-27", "2026-06-01", "2026-07-10", "2026-10-26", "2026-12-25", "2026-12-26", "2026-12-28"]) {
      expect(dates.has(date), date).toBe(true);
    }
  });

  it("lets holiday loading win over weekend loading", () => {
    const result = calculateShiftPay(
      { ...hourly, workDate: "2026-04-25" },
      { holidayMode: "multiplier", holidayMultiplierBps: 15_000, weekendSaturdayMultiplierBps: 20_000 },
      ["2026-04-25"],
    );
    expect(result.holidayLoadingCents).toBe(6_400);
    expect(result.weekendLoadingCents).toBe(0);
  });

  it("calculates a same-date partial overnight window", () => {
    expect(overnightOverlapMinutes(21 * 60, 23 * 60 + 30, 22 * 60, 6 * 60)).toBe(90);
    const result = calculateShiftPay(
      { ...hourly, workDate: "2026-10-27", paidMinutes: 150, startMinutes: 21 * 60, endMinutes: 23 * 60 + 30 },
      { overnightStartMinutes: 22 * 60, overnightEndMinutes: 6 * 60, overnightMultiplierBps: 15_000 },
      [],
    );
    expect(result.overnightLoadingCents).toBe(2_400);
  });

  it("short-circuits fixed-price pay without loadings", () => {
    const result = calculateShiftPay(
      { ...hourly, payMode: "fixed", fixedPayCents: 17_501 },
      { holidayMode: "multiplier", holidayMultiplierBps: 20_000, overnightStartMinutes: 0, overnightEndMinutes: 1_440, overnightMultiplierBps: 20_000 },
      [hourly.workDate],
    );
    expect(result).toEqual({ baseCents: 0, holidayLoadingCents: 0, weekendLoadingCents: 0, overnightLoadingCents: 0, fixedCents: 17_501, totalCents: 17_501 });
  });

  it("rounds each loading independently", () => {
    const result = calculateShiftPay(
      { ...hourly, workDate: "2026-10-27", paidMinutes: 1, rateCents: 3_030, startMinutes: 0, endMinutes: 1 },
      { overnightStartMinutes: 0, overnightEndMinutes: 1, overnightMultiplierBps: 15_000 },
      [],
    );
    expect(result.baseCents).toBe(51);
    expect(result.overnightLoadingCents).toBe(26);
    expect(result.totalCents).toBe(77);
  });

  it("adds no pay for zero-minute hourly rows and treats missing rules as all off", () => {
    expect(calculateShiftPay({ ...hourly, paidMinutes: 0, startMinutes: 0, endMinutes: 0 }, undefined, [])).toEqual({
      baseCents: 0,
      holidayLoadingCents: 0,
      weekendLoadingCents: 0,
      overnightLoadingCents: 0,
      fixedCents: 0,
      totalCents: 0,
    });
    expect(summarizeWeek([{ contractorId: "c", contractorName: "Aroha", paidMinutes: 0, rateCents: 3_200 }])[0]?.payCents).toBe(0);
  });
});
