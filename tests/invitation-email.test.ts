import { describe, expect, it } from "vitest";
import { invitationEmail } from "../src/lib/email-templates/invitation";
import { invitationAcceptUrl, invitationTokenDigest, invitationTokenMatches } from "../src/lib/invitation-token";
import {
  invitationActions,
  invitationDeliveryNotice,
  invitationErrorMessage,
  maskEmail,
  parseInvitationView,
} from "../src/lib/invitation-ui";

describe("invitation link and email", () => {
  it("puts the token only in the fragment and omits rates from the message", () => {
    const token = "abc_def-ghi";
    const inviteLink = invitationAcceptUrl("https://app.example.test", token);
    const parsed = new URL(inviteLink);
    expect(parsed.origin).toBe("https://app.example.test");
    expect(parsed.pathname).toBe("/invite");
    expect(parsed.search).toBe("");
    expect(parsed.hash).toBe(`#${token}`);
    expect(inviteLink).not.toContain("/invite?");
    expect(inviteLink).not.toContain(`/invite/${token}`);

    const message = invitationEmail({ businessName: "Northwind", firstName: "Aroha", inviteLink });
    expect(message.subject).toBe("Northwind invited you to CleanTrack");
    expect(message.html).toContain(`href="${inviteLink}"`);
    expect(message.text).toContain(inviteLink);
    expect(message.html).not.toMatch(/rate|pay|\$|notes/i);
    expect(message.text).not.toMatch(/rate|pay|\$|notes/i);
    expect(message.html).toMatchInlineSnapshot(`"<p>Hi Aroha,</p><p>Northwind invited you to view your work in CleanTrack.</p><p><a href="https://app.example.test/invite#abc_def-ghi">Accept invitation</a></p><p>This link expires in 7 days. If you were not expecting it, you can ignore this email.</p>"`);
    expect(message.text).toMatchInlineSnapshot(`
      "Hi Aroha,

      Northwind invited you to view your work in CleanTrack.

      Accept invitation: https://app.example.test/invite#abc_def-ghi

      This link expires in 7 days. If you were not expecting it, you can ignore this email."
    `);
  });

  it("compares a digest without keeping the token", async () => {
    const token = "token-value";
    const digest = await invitationTokenDigest(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
    expect(await invitationTokenMatches(token, digest)).toBe(true);
    expect(await invitationTokenMatches("other-token", digest)).toBe(false);
    expect(await invitationTokenMatches(token, "zz")).toBe(false);
  });
});

describe("invitation owner copy", () => {
  it("masks the recipient and chooses actions from the stored state", () => {
    expect(maskEmail("aroha@example.test")).toBe("a•••@example.test");
    expect(invitationDeliveryNotice("email", "aroha@example.test")).toBe("Email sent to a•••@example.test");
    expect(invitationDeliveryNotice("link_only", "aroha@example.test")).toBe("Email not sent — copy the link and send it privately");
    expect(invitationDeliveryNotice("email_failed", "aroha@example.test")).toBe("Email not sent — copy the link and send it privately");
    expect(invitationActions({ state: "none", eligible: true, hasLink: false })).toEqual(["invite"]);
    expect(invitationActions({ state: "pending", eligible: true, hasLink: true })).toEqual(["resend", "copy", "revoke"]);
    expect(invitationActions({ state: "expired", eligible: false, hasLink: false })).toEqual(["revoke"]);
    expect(invitationActions({ state: "accepted", eligible: true, hasLink: false })).toEqual([]);
    expect(parseInvitationView({ state: "none", expiresAt: null, sendCount: null, lastDelivery: null })?.state).toBe("none");
    expect(invitationErrorMessage("resend_too_soon")).toBe("Wait a minute before sending another link.");
    expect(invitationErrorMessage("invitation_conflict")).toBe("That link was just replaced. Refresh and try again.");
  });
});
