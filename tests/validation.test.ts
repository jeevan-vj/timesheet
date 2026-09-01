import { describe, expect, it } from "vitest";
import { contractorInput, siteInput, timeEntryInput, timeEntryUpdateInput } from "../src/lib/validation";

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
});

const clockUpdate = {
  entryMode: "clock" as const,
  contractorId: "c",
  siteId: "s",
  workDate: "2026-08-31",
  startMinutes: 480,
  endMinutes: 990,
  breakMinutes: 30,
};

const paidHoursUpdate = {
  entryMode: "paid_hours" as const,
  contractorId: "c",
  siteId: "s",
  workDate: "2026-08-31",
  paidMinutes: 480,
};

describe("time entry update validation", () => {
  it("accepts clock and paid_hours updates like create", () => {
    expect(timeEntryUpdateInput.parse(clockUpdate)).toMatchObject({
      entryMode: "clock",
      contractorId: "c",
      siteId: "s",
      workDate: "2026-08-31",
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
      notes: "",
    });
    expect(timeEntryUpdateInput.parse(paidHoursUpdate)).toMatchObject({
      entryMode: "paid_hours",
      paidMinutes: 480,
      notes: "",
    });
  });

  it("rejects zero or overnight paid minutes, malformed dates, and negative clock values", () => {
    expect(timeEntryUpdateInput.safeParse({ ...paidHoursUpdate, paidMinutes: 0 }).success).toBe(false);
    expect(timeEntryUpdateInput.safeParse({ ...paidHoursUpdate, paidMinutes: 1440 }).success).toBe(false);
    expect(timeEntryUpdateInput.safeParse({ ...clockUpdate, workDate: "31/08/2026" }).success).toBe(false);
    expect(timeEntryUpdateInput.safeParse({ ...clockUpdate, startMinutes: -1 }).success).toBe(false);
  });

  it("omits assignSite from the parsed update object", () => {
    const parsed = timeEntryUpdateInput.parse({
      ...clockUpdate,
      assignSite: { rateCents: 3_500 },
    });
    expect(parsed).not.toHaveProperty("assignSite");
  });

  it("does not parse client rateCents or owner identifiers onto the update object", () => {
    const parsed = timeEntryUpdateInput.parse({
      ...paidHoursUpdate,
      rateCents: 9_999,
      ownerUserId: "forged-owner",
      owner_user_id: "forged-owner",
    });
    expect(parsed).not.toHaveProperty("rateCents");
    expect(parsed).not.toHaveProperty("ownerUserId");
    expect(parsed).not.toHaveProperty("owner_user_id");
  });
});
