import { env } from "cloudflare:workers";
import { contractorInviteEmail, createEmailSender, type EmailEnvironment } from "@/lib/invite-email";
import type { InviteDelivery } from "@/services/invites";

export function emailEnvironment(): EmailEnvironment {
  return env as unknown as EmailEnvironment;
}

export function assertEmailConfigured(): void {
  createEmailSender(emailEnvironment());
}

export async function deliverInvite(invite: InviteDelivery): Promise<void> {
  const environment = emailEnvironment();
  const sender = createEmailSender(environment);
  const base = environment.APP_BASE_URL;
  if (!base) throw new Error("email_not_configured");
  const acceptUrl = new URL(`/invite/${invite.rawToken}`, base).toString();
  await sender.send(contractorInviteEmail({ to: invite.invitedEmail, businessName: invite.businessName, acceptUrl, expiresAt: new Date(invite.expiresAt) }));
}
