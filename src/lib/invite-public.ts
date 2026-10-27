import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";
import { invitationState, snapshotEmail } from "@/lib/invitation-view";

export type ClosedInviteState = "unknown" | "expired" | "revoked" | "used";
export type InviteMode = "setup" | "sign_in" | "mismatch" | "accept";
export type PasswordProblem = "password_mismatch" | "weak_password";

export type AcceptBody = {
  token: string;
  email: string;
  password: string | null;
  passwordConfirm: string | null;
};

const CLOSED: Record<ClosedInviteState, string> = {
  unknown: "This invitation link is not valid.",
  expired: "This invitation has expired.",
  revoked: "This invitation was revoked.",
  used: "This invitation has already been used.",
};

const MODES = new Set<InviteMode>(["setup", "sign_in", "mismatch", "accept"]);

export function classifyStoredInvite(input: {
  status: "pending" | "accepted" | "revoked";
  expiresAt: Date;
  now: Date;
  eligible: boolean;
  emailAligned: boolean;
}): ClosedInviteState | "pending" {
  if (input.status === "revoked") return "revoked";
  if (input.status === "accepted") return "used";
  if (invitationState({ status: "pending", expiresAt: input.expiresAt }, input.now) === "expired") return "expired";
  if (!input.eligible || !input.emailAligned) return "revoked";
  return "pending";
}

export function previewMode(input: { userExists: boolean; sessionEmail: string | null; inviteEmail: string }): InviteMode {
  const sessionEmail = input.sessionEmail ? snapshotEmail(input.sessionEmail) : null;
  const inviteEmail = snapshotEmail(input.inviteEmail);
  if (sessionEmail && sessionEmail !== inviteEmail) return "mismatch";
  if (sessionEmail === inviteEmail) return "accept";
  if (input.userExists) return "sign_in";
  return "setup";
}

export function passwordProblem(password: string | null, confirm: string | null): PasswordProblem | null {
  if (password === null || confirm === null || password !== confirm) return "password_mismatch";
  if (!passwordAccepted(password)) return "weak_password";
  return null;
}

export function passwordAccepted(password: string): boolean {
  return password.length >= AUTH_MIN_PASSWORD_LENGTH && password.length <= 128;
}

export function passwordStrengthHint(password: string): string {
  if (passwordAccepted(password)) return "Long enough to continue.";
  return `Use at least ${AUTH_MIN_PASSWORD_LENGTH} characters.`;
}

export function inviteClosedCopy(state: ClosedInviteState): { title: string; hint: string } {
  return { title: CLOSED[state], hint: "Ask your business for a new link." };
}

export function acceptErrorCopy(code: string): string {
  if (code === "weak_password") return `Use at least ${AUTH_MIN_PASSWORD_LENGTH} characters.`;
  if (code === "password_mismatch") return "Those passwords do not match.";
  if (code === "email_mismatch") return "That email does not match this invitation.";
  if (code === "rate_limited") return "Too many attempts. Try again shortly.";
  if (code === "account_mismatch") return "Sign out of the other account, then open the invitation again.";
  if (code === "sign_in_required") return "Sign in with this email to accept the invitation.";
  return "This invitation could not be accepted.";
}

export function parsePreviewBody(value: unknown): { token: string } | null {
  if (!value || typeof value !== "object") return null;
  const token = parseToken((value as { token?: unknown }).token);
  return token ? { token } : null;
}

export function parseAcceptBody(value: unknown): AcceptBody | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const token = parseToken(record.token);
  const email = parseEmail(record.email);
  const password = parsePassword(record.password);
  const passwordConfirm = parsePassword(record.passwordConfirm);
  if (!token || !email || password === undefined || passwordConfirm === undefined) return null;
  return { token, email, password, passwordConfirm };
}

export type InviteScreen =
  | { kind: "closed"; state: ClosedInviteState }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }
  | { kind: "ready"; mode: InviteMode; businessName: string; email: string; signedInEmail: string | null };

export function inviteScreen(status: number, body: unknown): InviteScreen {
  if (status === 429) return { kind: "rate_limited" };
  const ready = readyScreen(body);
  if (ready) return ready;
  const closed = closedScreen(body);
  if (closed) return closed;
  return { kind: "unavailable" };
}

export function isClosedInviteState(value: string): value is ClosedInviteState {
  return value === "unknown" || value === "expired" || value === "revoked" || value === "used";
}

function readyScreen(body: unknown): InviteScreen | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (record.state !== "ready" || !isMode(record.mode)) return null;
  if (typeof record.businessName !== "string" || typeof record.email !== "string") return null;
  return {
    kind: "ready",
    mode: record.mode,
    businessName: record.businessName,
    email: record.email,
    signedInEmail: typeof record.signedInEmail === "string" ? record.signedInEmail : null,
  };
}

function closedScreen(body: unknown): InviteScreen | null {
  if (!body || typeof body !== "object") return null;
  const state = (body as { state?: unknown }).state;
  if (typeof state !== "string" || !isClosedInviteState(state)) return null;
  return { kind: "closed", state };
}

function isMode(value: unknown): value is InviteMode {
  return typeof value === "string" && MODES.has(value as InviteMode);
}

function parseToken(value: unknown): string | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,200}$/.test(value)) return null;
  return value;
}

function parseEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) return null;
  return email;
}

function parsePassword(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > 200) return undefined;
  return value;
}
