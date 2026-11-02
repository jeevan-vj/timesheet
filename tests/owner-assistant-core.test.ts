import { describe, expect, it } from "vitest";
import { ownerAssistantPlanSchema, ownerAssistantTurnInputSchema, ownerAssistantTurnResponseSchema } from "@cleantrack/core/owner-assistant";

describe("owner assistant contracts", () => {
  it("accepts bounded chat history and the supported operations", () => {
    expect(ownerAssistantTurnInputSchema.parse({
      message: "Create Ana at 32 dollars an hour",
      history: [{ role: "assistant", content: "What is the contractor's name?" }],
    }).history).toHaveLength(1);
    expect(ownerAssistantPlanSchema.parse({
      intent: "create_contractor", reply: "I can prepare that.", name: "Ana Sample", defaultRateCents: 3_200,
    })).toMatchObject({ email: "", phone: "" });
  });

  it("rejects unbounded prompts and invalid pay or weeks", () => {
    expect(ownerAssistantTurnInputSchema.safeParse({ message: "x".repeat(501) }).success).toBe(false);
    expect(ownerAssistantPlanSchema.safeParse({ intent: "create_contractor", reply: "Ready", name: "Ana", defaultRateCents: 12 }).success).toBe(false);
    expect(ownerAssistantPlanSchema.safeParse({ intent: "get_remittance", reply: "Ready", contractorName: "Ana", weekStart: "2026-11-03" }).success).toBe(false);
  });

  it("requires canonical remittance totals in a response", () => {
    const response = {
      kind: "remittance", message: "Verified remittance.",
      verification: { status: "verified", detail: "Approved and locked." },
      remittance: {
        reference: "RA-c1-2026-10-26", filename: "remittance-ana-2026-11-01.pdf",
        contractorId: "c1", contractorName: "Ana", weekStart: "2026-10-26", weekEnd: "2026-11-01",
        remitterName: "Demo Cleaning", remitterEmail: "owner@example.test", currency: "NZD",
        lines: [{ workDate: "2026-10-26", siteName: "Demo Site", paidMinutes: 60, rateCents: 3_200, payCents: 3_200 }],
        paidMinutes: 60, payCents: 3_200, disclaimer: "Gross contractor pay only.",
      },
    };
    expect(ownerAssistantTurnResponseSchema.safeParse(response).success).toBe(true);
    expect(ownerAssistantTurnResponseSchema.safeParse({ ...response, remittance: { ...response.remittance, payCents: 9_999 } }).success).toBe(false);
  });
});
