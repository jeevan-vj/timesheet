import { escapeHtml, singleLine } from "@/lib/email-templates/text";

export function contractorFirstName(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first || "there";
}

export function invitationEmail(input: { businessName: string; firstName: string; inviteLink: string }): {
  subject: string;
  html: string;
  text: string;
} {
  const businessName = singleLine(input.businessName);
  const firstName = singleLine(input.firstName);
  const subject = `${businessName} invited you to CleanTrack`;
  const text = [
    `Hi ${firstName},`,
    "",
    `${businessName} invited you to view your work in CleanTrack.`,
    "",
    `Accept invitation: ${input.inviteLink}`,
    "",
    "This link expires in 7 days. If you were not expecting it, you can ignore this email.",
  ].join("\n");
  const html = [
    `<p>Hi ${escapeHtml(firstName)},</p>`,
    `<p>${escapeHtml(businessName)} invited you to view your work in CleanTrack.</p>`,
    `<p><a href="${escapeHtml(input.inviteLink)}">Accept invitation</a></p>`,
    "<p>This link expires in 7 days. If you were not expecting it, you can ignore this email.</p>",
  ].join("");
  return { subject, html, text };
}
