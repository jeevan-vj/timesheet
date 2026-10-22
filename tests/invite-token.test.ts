import { describe, expect, it } from "vitest";
import { createInviteToken, hashInviteToken, validInviteTokenShape } from "../src/lib/invite-token";

describe("invite tokens", () => {
  it("uses 32 random bytes encoded as base64url and stores a stable digest", async () => {
    const first = createInviteToken();
    const second = createInviteToken();
    expect(validInviteTokenShape(first)).toBe(true);
    expect(second).not.toBe(first);
    expect(await hashInviteToken(first)).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashInviteToken(first)).toBe(await hashInviteToken(first));
    expect(await hashInviteToken(first)).not.toContain(first);
  });
});
