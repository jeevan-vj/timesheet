export const INVITE_EXPIRY_DAYS = 7;
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";

export function effectiveInviteStatus(status: InviteStatus, expiresAt: Date, now: Date): InviteStatus {
  return status === "pending" && expiresAt.getTime() <= now.getTime() ? "expired" : status;
}

export function assertInviteCanResend(status: InviteStatus, expiresAt: Date, now: Date): void {
  const effective = effectiveInviteStatus(status, expiresAt, now);
  if (effective !== "pending" && effective !== "expired") throw new Error("not_found");
}

export function assertInviteCanRevoke(status: InviteStatus, expiresAt: Date, now: Date): void {
  if (effectiveInviteStatus(status, expiresAt, now) !== "pending") throw new Error("not_found");
}

export function assertInviteCanAccept(input: { status: InviteStatus; expiresAt: Date; invitedEmail: string; userEmail: string }, now: Date): void {
  if (effectiveInviteStatus(input.status, input.expiresAt, now) !== "pending") throw new Error("invite_unavailable");
  if (input.invitedEmail.trim().toLowerCase() !== input.userEmail.trim().toLowerCase()) throw new Error("invite_unavailable");
}

export function inviteExpiryFrom(now: Date): Date {
  return new Date(now.getTime() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
}
