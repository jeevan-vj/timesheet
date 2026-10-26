import type { InvitationDelivery, InvitationStateName, InvitationView } from "@/lib/invitation-view";

export type InvitationAction = "invite" | "resend" | "copy" | "revoke";

export type InvitationPrompt = {
  action: Exclude<InvitationAction, "copy">;
  title: string;
  description: string;
  confirm: string;
  cancel: string;
};

const STATES = new Set<InvitationStateName>(["none", "pending", "expired", "accepted", "revoked"]);
const DELIVERIES = new Set<InvitationDelivery>(["email", "link_only", "email_failed"]);

export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at <= 0) return "the contractor";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain) return "the contractor";
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function invitationDeliveryNotice(delivery: InvitationDelivery, email: string): string {
  if (delivery === "email") return `Email sent to ${maskEmail(email)}`;
  return "Email not sent — copy the link and send it privately";
}

export function invitationBadge(state: InvitationStateName, eligible: boolean): string {
  if (!eligible && state === "none") return "No portal access";
  if (state === "none") return "No invitation";
  if (state === "pending") return "Invitation pending";
  if (state === "expired") return "Invitation expired";
  if (state === "accepted") return "Portal access accepted";
  return "Invitation revoked";
}

export function invitationActions(input: {
  state: InvitationStateName;
  eligible: boolean;
  hasLink: boolean;
}): InvitationAction[] {
  if (input.state === "pending" || input.state === "expired") return pendingActions(input.eligible, input.hasLink);
  if (!input.eligible || input.state === "accepted") return [];
  return ["invite"];
}

function pendingActions(eligible: boolean, hasLink: boolean): InvitationAction[] {
  const actions: InvitationAction[] = [];
  if (eligible) actions.push("resend");
  if (hasLink) actions.push("copy");
  actions.push("revoke");
  return actions;
}

export function invitationPrompt(action: InvitationPrompt["action"], name: string): InvitationPrompt {
  if (action === "revoke") {
    return {
      action,
      title: `Revoke ${name}'s invitation?`,
      description: "The current link will stop working.",
      confirm: "Revoke invitation",
      cancel: "Keep invitation",
    };
  }
  if (action === "resend") {
    return {
      action,
      title: `Send ${name} a new link?`,
      description: "The previous link will stop working.",
      confirm: "Resend invitation",
      cancel: "Cancel",
    };
  }
  return {
    action,
    title: `Invite ${name} to the portal?`,
    description: "Their engagement status will become Invited. You can copy the link if email is not sent.",
    confirm: "Send invitation",
    cancel: "Cancel",
  };
}

export function invitationErrorMessage(code: string): string {
  if (code === "contractor_email_required") return "Add an email address before sending an invitation.";
  if (code === "already_linked") return "This contractor already has a portal login.";
  if (code === "invitation_not_pending") return "Only a pending invitation can be changed.";
  if (code === "invitation_exists") return "An invitation is already pending.";
  if (code === "not_found") return "That contractor could not be invited.";
  return "The invitation could not be updated. Please try again.";
}

export function parseInvitationView(value: unknown): InvitationView | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.state !== "string" || !STATES.has(record.state as InvitationStateName)) return null;
  const state = record.state as InvitationStateName;
  if (state === "none") return emptyView();
  return storedView(record, state);
}

function emptyView(): InvitationView {
  return { state: "none", expiresAt: null, sendCount: null, lastDelivery: null };
}

function storedView(record: Record<string, unknown>, state: InvitationStateName): InvitationView | null {
  if (typeof record.expiresAt !== "string" || typeof record.sendCount !== "number") return null;
  if (typeof record.lastDelivery !== "string" || !DELIVERIES.has(record.lastDelivery as InvitationDelivery)) return null;
  return {
    state,
    expiresAt: record.expiresAt,
    sendCount: record.sendCount,
    lastDelivery: record.lastDelivery as InvitationDelivery,
  };
}
