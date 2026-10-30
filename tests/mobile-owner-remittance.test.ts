import { describe, expect, it, vi } from "vitest";
import {
  OWNER_REMITTANCE_ACCEPT,
  OwnerRemittanceError,
  loadOwnerRemittance,
  ownerRemittanceMessage,
  ownerRemittancePath,
} from "../apps/mobile/src/owner-remittance";

const model = {
  reference: "RA-contractor-1-2026-10-26",
  filename: "remittance-pasindhu-2026-11-01.pdf",
  contractorId: "contractor-1",
  contractorName: "Pasindhu",
  weekStart: "2026-10-26",
  weekEnd: "2026-11-01",
  remitterName: "Demo Owner",
  remitterEmail: "owner@example.test",
  currency: "NZD" as const,
  lines: [{
    workDate: "2026-10-27",
    siteName: "Whitford",
    paidMinutes: 60,
    rateCents: 2_000,
    payCents: 2_000,
  }],
  paidMinutes: 60,
  payCents: 2_000,
  disclaimer: "Gross contractor payments before tax, GST, expenses, or adjustments.",
};

describe("mobile owner remittance", () => {
  it("builds only the selected contractor and Monday request", () => {
    expect(ownerRemittancePath("contractor-1", "2026-10-26"))
      .toBe("/api/contractors/contractor-1/remittance?week=2026-10-26");
    expect(() => ownerRemittancePath("../contractor", "2026-10-26")).toThrowError(OwnerRemittanceError);
    expect(() => ownerRemittancePath("contractor-1", "2026-10-27")).toThrowError(OwnerRemittanceError);
  });

  it("requests the non-persisted JSON representation and validates canonical totals", async () => {
    const send = vi.fn(async () => ({ status: 200, body: model }));
    await expect(loadOwnerRemittance("contractor-1", "2026-10-26", send)).resolves.toEqual(model);
    expect(send).toHaveBeenCalledWith(
      "/api/contractors/contractor-1/remittance?week=2026-10-26",
      { method: "GET", headers: { accept: OWNER_REMITTANCE_ACCEPT } },
    );

    await expect(loadOwnerRemittance("contractor-1", "2026-10-26", async () => ({
      status: 200,
      body: { ...model, payCents: 1 },
    }))).rejects.toMatchObject({ code: "unavailable" });
  });

  it.each([
    [401, { error: "unauthorized" }, "unauthorized"],
    [400, { error: "no_entries" }, "no_entries"],
    [400, { error: "invalid_week" }, "invalid_week"],
    [404, { error: "not_found" }, "not_found"],
    [500, { error: "internal_error" }, "unavailable"],
  ] as const)("maps status %s without exposing response details", async (status, body, code) => {
    await expect(loadOwnerRemittance("contractor-1", "2026-10-26", async () => ({ status, body })))
      .rejects.toMatchObject({ code });
  });

  it("keeps network failures retryable and gives distinct safe copy", async () => {
    await expect(loadOwnerRemittance("contractor-1", "2026-10-26", async () => {
      throw new TypeError("network details");
    })).rejects.toMatchObject({ code: "offline" });
    expect(ownerRemittanceMessage(new OwnerRemittanceError("offline")).title).toBe("You're offline");
    expect(ownerRemittanceMessage(new OwnerRemittanceError("no_entries")).title).toBe("No remittance for this week");
    expect(ownerRemittanceMessage(new OwnerRemittanceError("unauthorized")).title).toBe("Sign in again");
  });
});
