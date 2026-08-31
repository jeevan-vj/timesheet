import { describe, expect, it } from "vitest";
import { contractorInput, siteInput, timeEntryInput } from "../src/lib/validation";

describe("API validation", () => {
  it("accepts an integer-cent contractor rate", () => {
    expect(contractorInput.parse({ name: "Aroha", email: "a@example.test", defaultRateCents: 3200 }).defaultRateCents).toBe(3200);
  });

  it("rejects fractional or implausible rates", () => {
    expect(contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 30.5 }).success).toBe(false);
    expect(contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 100 }).success).toBe(false);
  });

  it("normalises trimmed site values", () => {
    expect(siteInput.parse({ name: "  Harbour Offices ", address: " 1 Quay St " })).toEqual({ name: "Harbour Offices", address: "1 Quay St" });
  });

  it("rejects malformed dates and clock values", () => {
    expect(timeEntryInput.safeParse({ contractorId: "c", siteId: "s", workDate: "31/08/2026", startMinutes: 480, endMinutes: 960, breakMinutes: 30 }).success).toBe(false);
    expect(timeEntryInput.safeParse({ contractorId: "c", siteId: "s", workDate: "2026-08-31", startMinutes: -1, endMinutes: 960, breakMinutes: 30 }).success).toBe(false);
  });
});
