import { describe, expect, it } from "vitest";
import { readOwnerAssistantConfirmation, signOwnerAssistantConfirmation } from "@/lib/owner-assistant-confirm";

describe("owner assistant confirmation", () => {
  it("binds a short-lived action to the session owner", async () => {
    const signed = await signOwnerAssistantConfirmation("owner-1", {
      kind: "create_site", name: "Demo Site", address: "1 Example Road",
    }, "secret", 1_000);
    const read = await readOwnerAssistantConfirmation(signed.token, "secret", 2_000);
    expect(read).toMatchObject({ ok: true, payload: { ownerUserId: "owner-1", action: { kind: "create_site" } } });
    expect(signed.token).not.toContain("Demo Site");
  });

  it("rejects changed, expired, or differently signed tokens", async () => {
    const signed = await signOwnerAssistantConfirmation("owner-1", {
      kind: "create_contractor", name: "Ana", email: "", phone: "", defaultRateCents: 3_200,
    }, "secret", 1_000);
    expect(await readOwnerAssistantConfirmation(`${signed.token}x`, "secret", 2_000)).toEqual({ ok: false, error: "confirm_mismatch" });
    expect(await readOwnerAssistantConfirmation(signed.token, "other", 2_000)).toEqual({ ok: false, error: "confirm_mismatch" });
    expect(await readOwnerAssistantConfirmation(signed.token, "secret", 400_000)).toEqual({ ok: false, error: "confirm_expired" });
  });
});
