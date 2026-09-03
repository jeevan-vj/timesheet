import { describe, expect, it } from "vitest";
import { assignmentInput, assignmentRateInput, contractorInput, invalidRequestFromZod, parseIncludeArchived, siteInput, timeEntryInput, timeEntryUpdateInput } from "../src/lib/validation";

describe("API validation", () => {
  it("accepts an integer-cent contractor rate", () => {
    expect(contractorInput.parse({ name: "Aroha", email: "a@example.test", defaultRateCents: 3200 }).defaultRateCents).toBe(3200);
  });

  it("rejects fractional or implausible rates", () => {
    expect(contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 30.5 }).success).toBe(false);
    expect(contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 100 }).success).toBe(false);
  });

  it("strips ownership and lifecycle fields from contractor input", () => {
    expect(contractorInput.parse({
      name: "Aroha",
      defaultRateCents: 3200,
      ownerUserId: "forged",
      currency: "USD",
      active: false,
      id: "forged-id",
    })).toEqual({ name: "Aroha", email: "", phone: "", defaultRateCents: 3200 });
  });

  it("maps contractor Zod issues to the first generic message per known field", () => {
    const name = contractorInput.safeParse({ name: "", email: "", defaultRateCents: 3200 });
    expect(name.success).toBe(false);
    if (!name.success) {
      expect(invalidRequestFromZod(name.error)).toEqual({
        error: "invalid_request",
        fields: { name: "Enter a name between 1 and 100 characters." },
      });
    }

    const email = contractorInput.safeParse({ name: "A", email: "not-an-email", defaultRateCents: 3200 });
    expect(email.success).toBe(false);
    if (!email.success) {
      expect(invalidRequestFromZod(email.error)).toEqual({
        error: "invalid_request",
        fields: { email: "Enter a valid email or leave it blank." },
      });
    }

    const phone = contractorInput.safeParse({ name: "A", email: "", phone: "x".repeat(41), defaultRateCents: 3200 });
    expect(phone.success).toBe(false);
    if (!phone.success) {
      expect(invalidRequestFromZod(phone.error)).toEqual({
        error: "invalid_request",
        fields: { phone: "Phone must be at most 40 characters." },
      });
    }

    const fractional = contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 30.5 });
    expect(fractional.success).toBe(false);
    if (!fractional.success) {
      expect(invalidRequestFromZod(fractional.error)).toEqual({
        error: "invalid_request",
        fields: { defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250)." },
      });
    }

    const tooLow = contractorInput.safeParse({ name: "A", email: "", defaultRateCents: 100 });
    expect(tooLow.success).toBe(false);
    if (!tooLow.success) {
      expect(invalidRequestFromZod(tooLow.error)).toEqual({
        error: "invalid_request",
        fields: { defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250)." },
      });
    }

    const many = contractorInput.safeParse({ name: "", email: "bad", phone: "x".repeat(41), defaultRateCents: 100 });
    expect(many.success).toBe(false);
    if (!many.success) {
      expect(invalidRequestFromZod(many.error)).toEqual({
        error: "invalid_request",
        fields: {
          name: "Enter a name between 1 and 100 characters.",
          email: "Enter a valid email or leave it blank.",
          phone: "Phone must be at most 40 characters.",
          defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250).",
        },
      });
    }

    const root = contractorInput.safeParse(1);
    expect(root.success).toBe(false);
    if (!root.success) {
      expect(invalidRequestFromZod(root.error)).toEqual({ error: "invalid_request" });
    }
  });

  it("normalises trimmed site values", () => {
    expect(siteInput.parse({ name: "  Harbour Offices ", address: " 1 Quay St " })).toEqual({ name: "Harbour Offices", address: "1 Quay St" });
  });

  it("rejects empty or overlong site fields and ignores active or owner ids", () => {
    expect(siteInput.safeParse({ name: "", address: "1 Quay St" }).success).toBe(false);
    expect(siteInput.safeParse({ name: "A".repeat(101) }).success).toBe(false);
    expect(siteInput.safeParse({ name: "Harbour", address: "A".repeat(241) }).success).toBe(false);
    expect(siteInput.parse({ name: "Harbour", address: "1 Quay St", active: false, owner_user_id: "forged" })).toEqual({
      name: "Harbour",
      address: "1 Quay St",
    });
  });

  it("treats only includeArchived=1 as including archived sites", () => {
    expect(parseIncludeArchived("1")).toBe(true);
    expect(parseIncludeArchived(null)).toBe(false);
    expect(parseIncludeArchived("")).toBe(false);
    expect(parseIncludeArchived("0")).toBe(false);
    expect(parseIncludeArchived("true")).toBe(false);
    expect(parseIncludeArchived("yes")).toBe(false);
    expect(parseIncludeArchived("all")).toBe(false);
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
