import { describe, expect, it } from "vitest";
import { assignmentInput, assignmentRateInput, contractorInput, siteInput, timeEntryInput } from "../src/lib/validation";

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
    expect(timeEntryInput.safeParse({ entryMode: "clock", contractorId: "c", siteId: "s", workDate: "31/08/2026", startMinutes: 480, endMinutes: 960, breakMinutes: 30 }).success).toBe(false);
    expect(timeEntryInput.safeParse({ entryMode: "clock", contractorId: "c", siteId: "s", workDate: "2026-08-31", startMinutes: -1, endMinutes: 960, breakMinutes: 30 }).success).toBe(false);
  });

  it("accepts paid hours without start, finish, or break", () => {
    expect(timeEntryInput.parse({
      entryMode: "paid_hours",
      contractorId: "c",
      siteId: "s",
      workDate: "2026-08-31",
      paidMinutes: 480,
    })).toMatchObject({ entryMode: "paid_hours", paidMinutes: 480, notes: "" });
  });

  it("rejects paid hours that are missing, zero, or overnight", () => {
    expect(timeEntryInput.safeParse({ entryMode: "paid_hours", contractorId: "c", siteId: "s", workDate: "2026-08-31" }).success).toBe(false);
    expect(timeEntryInput.safeParse({ entryMode: "paid_hours", contractorId: "c", siteId: "s", workDate: "2026-08-31", paidMinutes: 0 }).success).toBe(false);
    expect(timeEntryInput.safeParse({ entryMode: "paid_hours", contractorId: "c", siteId: "s", workDate: "2026-08-31", paidMinutes: 1440 }).success).toBe(false);
  });

  it("accepts an optional inline assignment rate on either entry method", () => {
    expect(timeEntryInput.parse({
      entryMode: "clock",
      contractorId: "c",
      siteId: "s",
      workDate: "2026-08-31",
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
      assignSite: { rateCents: 3_500 },
    }).assignSite).toEqual({ rateCents: 3_500 });
    expect(timeEntryInput.parse({
      entryMode: "paid_hours",
      contractorId: "c",
      siteId: "s",
      workDate: "2026-08-31",
      paidMinutes: 120,
      assignSite: {},
    }).assignSite).toEqual({ rateCents: null });
  });

  it("accepts assignment create rates including null and the inherited default", () => {
    expect(assignmentInput.parse({ contractorId: "c", siteId: "s", rateCents: 1_500 }).rateCents).toBe(1_500);
    expect(assignmentInput.parse({ contractorId: "c", siteId: "s", rateCents: 25_000 }).rateCents).toBe(25_000);
    expect(assignmentInput.parse({ contractorId: "c", siteId: "s", rateCents: null }).rateCents).toBeNull();
    expect(assignmentInput.parse({ contractorId: "c", siteId: "s" }).rateCents).toBeNull();
  });

  it("rejects assignment create rates below 1500, above 25000, or non-integers", () => {
    expect(assignmentInput.safeParse({ contractorId: "c", siteId: "s", rateCents: 1_499 }).success).toBe(false);
    expect(assignmentInput.safeParse({ contractorId: "c", siteId: "s", rateCents: 25_001 }).success).toBe(false);
    expect(assignmentInput.safeParse({ contractorId: "c", siteId: "s", rateCents: 30.5 }).success).toBe(false);
  });

  it("requires PATCH assignmentRateInput.rateCents and allows null within the same bounds", () => {
    expect(assignmentRateInput.parse({ rateCents: 2_200 })).toEqual({ rateCents: 2_200 });
    expect(assignmentRateInput.parse({ rateCents: null })).toEqual({ rateCents: null });
    expect(assignmentRateInput.safeParse({}).success).toBe(false);
    expect(assignmentRateInput.safeParse({ rateCents: 1_499 }).success).toBe(false);
    expect(assignmentRateInput.safeParse({ rateCents: 25_001 }).success).toBe(false);
    expect(assignmentRateInput.safeParse({ rateCents: 3_200.1 }).success).toBe(false);
  });
});
