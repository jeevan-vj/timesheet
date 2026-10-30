import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  OWNER_TEAM_MUTATION_MESSAGES,
  ownerContractorFormPayload,
  ownerContractorsPath,
  ownerTeamMutationRequest,
  parseOwnerTeamMutationResponse,
  runOwnerTeamMutation,
  type OwnerContractorFormDraft,
} from "../apps/mobile/src/owner-team";

const validDraft: OwnerContractorFormDraft = {
  name: "Aroha North",
  email: "aroha@example.test",
  phone: "021 555 0101",
  defaultRate: "32.50",
};

describe("mobile owner team management", () => {
  it("loads current or archived contractors through the existing owner collection", () => {
    expect(ownerContractorsPath(false)).toBe("/api/contractors");
    expect(ownerContractorsPath(true)).toBe("/api/contractors?includeArchived=1");
  });

  it("validates the focused mobile form with the shared contractor rules", () => {
    expect(ownerContractorFormPayload(validDraft)).toEqual({
      ok: true,
      payload: {
        name: "Aroha North",
        email: "aroha@example.test",
        phone: "021 555 0101",
        defaultRateCents: 3_250,
      },
    });

    expect(ownerContractorFormPayload({ ...validDraft, email: "not-an-email", defaultRate: "14.999" })).toEqual({
      ok: false,
      fields: {
        email: "Enter a valid email or leave it blank.",
        defaultRate: "Enter an hourly rate from NZ$15.00 to NZ$250.00.",
      },
    });
  });

  it("builds only the documented contractor and invitation mutations", () => {
    const parsed = ownerContractorFormPayload(validDraft);
    expect(ownerTeamMutationRequest({ kind: "create", payload: parsed.ok ? parsed.payload : neverPayload() })).toEqual({
      path: "/api/contractors",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Aroha North",
          email: "aroha@example.test",
          phone: "021 555 0101",
          defaultRateCents: 3_250,
        }),
      },
    });
    expect(ownerTeamMutationRequest({ kind: "update", contractorId: "contractor_1", payload: {
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3_200,
    } })).toMatchObject({ path: "/api/contractors/contractor_1", init: { method: "PATCH" } });
    expect(ownerTeamMutationRequest({ kind: "archive", contractorId: "contractor_1" })).toEqual({
      path: "/api/contractors/contractor_1/archive",
      init: { method: "POST" },
    });
    expect(ownerTeamMutationRequest({ kind: "restore", contractorId: "contractor_1" }).path).toBe("/api/contractors/contractor_1/restore");
    expect(ownerTeamMutationRequest({ kind: "invite", contractorId: "contractor_1" }).path).toBe("/api/contractors/contractor_1/invitation");
    expect(ownerTeamMutationRequest({ kind: "resend", contractorId: "contractor_1" }).path).toBe("/api/contractors/contractor_1/invitation/resend");
    expect(ownerTeamMutationRequest({ kind: "revoke", contractorId: "contractor_1" }).path).toBe("/api/contractors/contractor_1/invitation/revoke");
    expect(() => ownerTeamMutationRequest({ kind: "archive", contractorId: "../other" })).toThrow(/not available/i);
  });

  it("parses contractor, invitation issue, and invitation revoke responses", () => {
    const contractor = {
      id: "contractor_1",
      name: "Aroha",
      email: "aroha@example.test",
      phone: "",
      defaultRateCents: 3_200,
      currency: "NZD",
      active: true,
      preferredName: "",
      startDate: null,
      engagementStatus: "active",
      gstRegistered: false,
      gstNumber: "",
      internalNotes: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      createdAt: "2026-10-30T00:00:00.000Z",
      updatedAt: "2026-10-30T00:00:00.000Z",
    } as const;
    const invitation = { state: "pending", expiresAt: "2026-11-06T00:00:00.000Z", sendCount: 1, lastDelivery: "link_only" } as const;

    expect(parseOwnerTeamMutationResponse({ kind: "create", payload: { name: "Aroha", email: "", phone: "", defaultRateCents: 3_200 } }, contractor)).toEqual({ contractor });
    expect(parseOwnerTeamMutationResponse({ kind: "invite", contractorId: "contractor_1" }, {
      invitation,
      delivery: "link_only",
      inviteLink: "https://app.example.test/invite#secret-fragment",
    })).toEqual({ invitation, delivery: "link_only", inviteLink: "https://app.example.test/invite#secret-fragment" });
    expect(parseOwnerTeamMutationResponse({ kind: "revoke", contractorId: "contractor_1" }, {
      invitation: { ...invitation, state: "revoked", expiresAt: null, lastDelivery: null },
    })).toEqual({ invitation: { ...invitation, state: "revoked", expiresAt: null, lastDelivery: null } });
    expect(() => parseOwnerTeamMutationResponse({ kind: "invite", contractorId: "contractor_1" }, { inviteLink: "not-a-response" })).toThrow(/invalid response/i);
  });

  it("maps domain and network failures without exposing server details or retrying", async () => {
    const duplicate = vi.fn(async () => ({ status: 409, body: { error: "duplicate_contractor" } }));
    await expect(runOwnerTeamMutation({ kind: "create", payload: {
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3_200,
    } }, duplicate)).resolves.toEqual({
      ok: false,
      error: { code: "duplicate_contractor", message: OWNER_TEAM_MUTATION_MESSAGES.duplicateContractor },
    });
    expect(duplicate).toHaveBeenCalledOnce();

    await expect(runOwnerTeamMutation({ kind: "resend", contractorId: "contractor_1" }, async () => ({
      status: 429,
      body: { error: "resend_too_soon", detail: "secret provider body" },
    }))).resolves.toEqual({
      ok: false,
      error: { code: "resend_too_soon", message: OWNER_TEAM_MUTATION_MESSAGES.resendTooSoon },
    });

    await expect(runOwnerTeamMutation({ kind: "archive", contractorId: "contractor_1" }, async () => {
      throw new TypeError("network details");
    })).resolves.toEqual({
      ok: false,
      error: { code: "offline", message: OWNER_TEAM_MUTATION_MESSAGES.offline },
    });
  });

  it("keeps one-time invitation links out of logs and persisted storage", () => {
    const source = [
      "apps/mobile/src/components/owner-contractor-management.tsx",
      "apps/mobile/src/owner-team.ts",
      "apps/mobile/src/owner-mutations-client.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    expect(source).not.toMatch(/console\.|Sentry|AsyncStorage|SecureStore/);
    expect(source).toContain("Share.share({ message: issued.inviteLink");
    expect(source).not.toMatch(/<Text[^>]*>\{issued\.inviteLink\}/);
  });
});

function neverPayload(): never {
  throw new Error("Expected valid form payload");
}
