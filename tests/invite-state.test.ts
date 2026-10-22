import { describe, expect, it } from "vitest";
import { assertInviteCanAccept, assertInviteCanResend, assertInviteCanRevoke, effectiveInviteStatus, inviteExpiryFrom } from "../src/lib/invite-state";

const now = new Date("2026-10-22T00:00:00Z");
const future = new Date("2026-10-29T00:00:00Z");
const past = new Date("2026-10-21T23:59:59Z");

describe("invite state machine", () => {
  it("expires at seven days and permits only documented resend/revoke transitions", () => {
    expect(inviteExpiryFrom(now)).toEqual(future);
    expect(effectiveInviteStatus("pending", past, now)).toBe("expired");
    expect(() => assertInviteCanResend("pending", future, now)).not.toThrow();
    expect(() => assertInviteCanResend("expired", past, now)).not.toThrow();
    expect(() => assertInviteCanResend("accepted", future, now)).toThrow("not_found");
    expect(() => assertInviteCanRevoke("pending", future, now)).not.toThrow();
    expect(() => assertInviteCanRevoke("pending", past, now)).toThrow("not_found");
  });

  it("fails closed for expired, revoked, replayed and wrong-email acceptance", () => {
    expect(() => assertInviteCanAccept({ status: "pending", expiresAt: future, invitedEmail: "Sam@Example.test", userEmail: "sam@example.test" }, now)).not.toThrow();
    for (const status of ["accepted", "revoked"] as const) {
      expect(() => assertInviteCanAccept({ status, expiresAt: future, invitedEmail: "sam@example.test", userEmail: "sam@example.test" }, now)).toThrow("invite_unavailable");
    }
    expect(() => assertInviteCanAccept({ status: "pending", expiresAt: past, invitedEmail: "sam@example.test", userEmail: "sam@example.test" }, now)).toThrow("invite_unavailable");
    expect(() => assertInviteCanAccept({ status: "pending", expiresAt: future, invitedEmail: "sam@example.test", userEmail: "other@example.test" }, now)).toThrow("invite_unavailable");
  });
});
