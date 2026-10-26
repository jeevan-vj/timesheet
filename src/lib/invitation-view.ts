export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60_000;

export type InvitationDelivery = "email" | "link_only" | "email_failed";
export type InvitationStateName = "none" | "pending" | "expired" | "accepted" | "revoked";

export type InvitationView = {
  state: InvitationStateName;
  expiresAt: string | null;
  sendCount: number | null;
  lastDelivery: InvitationDelivery | null;
};

export type InvitationIssued = {
  invitation: InvitationView;
  delivery: InvitationDelivery;
  inviteLink: string;
};

export type InvitationSnapshot = {
  status: "pending" | "accepted" | "revoked";
  expiresAt: Date | number;
  sendCount: number;
  lastDelivery: InvitationDelivery;
};

export function emptyInvitationView(): InvitationView {
  return { state: "none", expiresAt: null, sendCount: null, lastDelivery: null };
}

export function toInvitationView(row: InvitationSnapshot, now: Date): InvitationView {
  return {
    state: invitationState(row, now),
    expiresAt: asDate(row.expiresAt).toISOString(),
    sendCount: row.sendCount,
    lastDelivery: row.lastDelivery,
  };
}

export function invitationState(row: Pick<InvitationSnapshot, "status" | "expiresAt">, now: Date): InvitationStateName {
  if (row.status !== "pending") return row.status;
  if (asDate(row.expiresAt).getTime() < now.getTime()) return "expired";
  return "pending";
}

export function resendTooSoon(lastSentAt: Date | number, now: Date): boolean {
  return now.getTime() - asDate(lastSentAt).getTime() < RESEND_COOLDOWN_MS;
}

export function asDate(value: Date | number): Date {
  if (value instanceof Date) return value;
  const millis = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(millis);
}

export function snapshotEmail(email: string): string {
  return email.trim().toLowerCase();
}
