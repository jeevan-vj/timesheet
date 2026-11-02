import { describe, expect, it } from "vitest";
import { parseOwnerAssistantPlan } from "@/lib/owner-assistant-ai";

describe("owner assistant AI output", () => {
  it("accepts a structured Workers AI response", () => {
    expect(parseOwnerAssistantPlan({ response: JSON.stringify({
      intent: "assign_site", reply: "I will prepare the assignment.",
      contractorName: "Ana Sample", siteName: "Demo Site", rateCents: null,
    }) })).toMatchObject({ intent: "assign_site", rateCents: null });
  });

  it("fails closed when the model returns invalid output", () => {
    expect(() => parseOwnerAssistantPlan({ response: "not json" })).toThrow("assistant_unavailable");
    expect(() => parseOwnerAssistantPlan({ response: JSON.stringify({ intent: "delete_everything", reply: "Done" }) })).toThrow("assistant_unavailable");
  });
});
