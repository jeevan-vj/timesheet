import { describe, expect, it } from "vitest";
import {
  clockFieldsForWrite,
  hasDuplicateTimeEntry,
  paidHoursClockFields,
  rateCentsForUpdate,
  shouldResnapshotRate,
} from "../src/lib/time-entry-write";

describe("paidHoursClockFields", () => {
  it("stores paid hours as a same-day sentinel window with no break", () => {
    expect(paidHoursClockFields(480)).toEqual({ startMinutes: 0, endMinutes: 480, breakMinutes: 0 });
    expect(paidHoursClockFields(1)).toEqual({ startMinutes: 0, endMinutes: 1, breakMinutes: 0 });
  });
});

describe("clockFieldsForWrite", () => {
  it("uses paid-hours sentinels and the submitted paid minutes", () => {
    expect(clockFieldsForWrite({ entryMode: "paid_hours", paidMinutes: 120 })).toEqual({
      entryMode: "paid_hours",
      paidMinutes: 120,
      startMinutes: 0,
      endMinutes: 120,
      breakMinutes: 0,
    });
  });

  it("stores real clock fields and paid minutes from calculatePaidMinutes", () => {
    expect(clockFieldsForWrite({
      entryMode: "clock",
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
    })).toEqual({
      entryMode: "clock",
      paidMinutes: 480,
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
    });
  });

  it("rejects an invalid clock shift", () => {
    expect(() => clockFieldsForWrite({
      entryMode: "clock",
      startMinutes: 600,
      endMinutes: 600,
      breakMinutes: 0,
    })).toThrow("invalid_shift");
  });
});

describe("shouldResnapshotRate", () => {
  const existing = { contractorId: "c1", siteId: "s1" };

  it("is false when contractor and site are unchanged", () => {
    expect(shouldResnapshotRate(existing, { contractorId: "c1", siteId: "s1" })).toBe(false);
  });

  it("is true when contractor or site changes", () => {
    expect(shouldResnapshotRate(existing, { contractorId: "c2", siteId: "s1" })).toBe(true);
    expect(shouldResnapshotRate(existing, { contractorId: "c1", siteId: "s2" })).toBe(true);
    expect(shouldResnapshotRate(existing, { contractorId: "c2", siteId: "s2" })).toBe(true);
  });
});

describe("rateCentsForUpdate", () => {
  it("keeps the original snapshot when contractor and site are unchanged", () => {
    expect(rateCentsForUpdate({
      existingRateCents: 3_200,
      resnapshot: false,
      assignmentEffectiveRate: 4_000,
    })).toBe(3_200);
  });

  it("uses the assignment effective rate when reclassifying", () => {
    expect(rateCentsForUpdate({
      existingRateCents: 3_200,
      resnapshot: true,
      assignmentEffectiveRate: 2_800,
    })).toBe(2_800);
  });

  it("throws not_found when a reclassification has no assignment rate", () => {
    expect(() => rateCentsForUpdate({
      existingRateCents: 3_200,
      resnapshot: true,
      assignmentEffectiveRate: null,
    })).toThrow("not_found");
    expect(() => rateCentsForUpdate({
      existingRateCents: 3_200,
      resnapshot: true,
      assignmentEffectiveRate: undefined,
    })).toThrow("not_found");
  });
});

describe("hasDuplicateTimeEntry", () => {
  it("treats another row id as a duplicate and ignores the current entry", () => {
    expect(hasDuplicateTimeEntry("entry-1", "entry-2")).toBe(true);
    expect(hasDuplicateTimeEntry("entry-1", "entry-1")).toBe(false);
    expect(hasDuplicateTimeEntry("entry-1", undefined)).toBe(false);
    expect(hasDuplicateTimeEntry("entry-1", null)).toBe(false);
  });
});
