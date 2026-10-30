import {
  contractorInput,
  ownerContractorSchema,
  ownerInvitationSchema,
  type OwnerContractor,
  type OwnerInvitation,
} from "@cleantrack/core";
import { z } from "zod";

export type OwnerContractorFormDraft = {
  name: string;
  email: string;
  phone: string;
  defaultRate: string;
};

export type OwnerContractorFormField = keyof OwnerContractorFormDraft;
export type OwnerContractorPayload = {
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
};

export type OwnerTeamAction =
  | { kind: "create"; payload: OwnerContractorPayload }
  | { kind: "update"; contractorId: string; payload: OwnerContractorPayload }
  | { kind: "archive" | "restore" | "invite" | "resend" | "revoke"; contractorId: string };

type OwnerTeamRequest = {
  path: string;
  init: {
    method: "POST" | "PATCH";
    headers?: { "content-type": "application/json" };
    body?: string;
  };
};

export type OwnerInvitationIssue = {
  invitation: OwnerInvitation;
  delivery: "email" | "link_only" | "email_failed";
  inviteLink: string;
};

export type OwnerTeamMutationBody =
  | { contractor: OwnerContractor }
  | OwnerInvitationIssue
  | { invitation: OwnerInvitation };

export type OwnerTeamMutationCode =
  | "invalid_request"
  | "duplicate_contractor"
  | "contractor_email_required"
  | "already_linked"
  | "invitation_exists"
  | "invitation_not_pending"
  | "resend_too_soon"
  | "invitation_conflict"
  | "not_found"
  | "unauthorized"
  | "business_required"
  | "offline"
  | "unavailable";

export type OwnerTeamMutationError = {
  code: OwnerTeamMutationCode;
  message: string;
  fields?: Partial<Record<OwnerContractorFormField, string>>;
};

export type OwnerTeamMutationResult =
  | { ok: true; body: OwnerTeamMutationBody }
  | { ok: false; error: OwnerTeamMutationError };

export type OwnerTeamMutationSend = (
  path: string,
  init: OwnerTeamRequest["init"],
) => Promise<{ status: number; body: unknown }>;

export const OWNER_TEAM_MUTATION_MESSAGES = {
  invalidRequest: "Check the highlighted fields and try again.",
  duplicateContractor: "A contractor with that name already exists, including archived contractors.",
  contractorEmailRequired: "Add an email address before sending an invitation.",
  alreadyLinked: "This contractor already has portal access.",
  invitationExists: "An invitation is already pending. Resend or revoke it instead.",
  invitationNotPending: "This invitation changed. Refresh the contractor and try again.",
  resendTooSoon: "Wait a minute before resending this invitation.",
  invitationConflict: "This invitation changed while you were viewing it. Refresh and try again.",
  notFound: "This contractor is no longer available. Return to Team and refresh.",
  unauthorized: "Your session ended. Sign in again.",
  businessRequired: "Finish business setup on the web before managing contractors.",
  offline: "You're offline. Check your connection and try again.",
  unavailable: "CleanTrack couldn't save this change. Try again.",
} as const;

const ownerContractorPayloadSchema = contractorInput.pick({
  name: true,
  email: true,
  phone: true,
  defaultRateCents: true,
});

const invitationIssueSchema = z.object({
  invitation: ownerInvitationSchema,
  delivery: z.enum(["email", "link_only", "email_failed"]),
  inviteLink: z.url(),
}).strict();

const invitationMutationSchema = z.object({ invitation: ownerInvitationSchema }).strict();

const FORM_MESSAGES: Record<OwnerContractorFormField, string> = {
  name: "Enter a name between 1 and 100 characters.",
  email: "Enter a valid email or leave it blank.",
  phone: "Phone must be at most 40 characters.",
  defaultRate: "Enter an hourly rate from NZ$15.00 to NZ$250.00.",
};

export function ownerContractorsPath(includeArchived: boolean): string {
  return includeArchived ? "/api/contractors?includeArchived=1" : "/api/contractors";
}

function rateCentsFromText(value: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return null;
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const total = dollars * 100 + cents;
  return total >= 1_500 && total <= 25_000 ? total : null;
}

export function ownerContractorFormPayload(draft: OwnerContractorFormDraft):
  | { ok: true; payload: OwnerContractorPayload }
  | { ok: false; fields: Partial<Record<OwnerContractorFormField, string>> } {
  const defaultRateCents = rateCentsFromText(draft.defaultRate);
  const candidate = {
    name: draft.name,
    email: draft.email,
    phone: draft.phone,
    defaultRateCents: defaultRateCents ?? Number.NaN,
  };
  const parsed = ownerContractorPayloadSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, payload: parsed.data };

  const fields: Partial<Record<OwnerContractorFormField, string>> = {};
  for (const issue of parsed.error.issues) {
    const raw = issue.path[0];
    const field = raw === "defaultRateCents" ? "defaultRate" : raw;
    if (typeof field !== "string" || !(field in FORM_MESSAGES)) continue;
    const formField = field as OwnerContractorFormField;
    fields[formField] ??= FORM_MESSAGES[formField];
  }
  if (defaultRateCents == null) fields.defaultRate = FORM_MESSAGES.defaultRate;
  return { ok: false, fields };
}

function ownerContractorResourceId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("This contractor is not available.");
  return id;
}

export function ownerTeamMutationRequest(action: OwnerTeamAction): OwnerTeamRequest {
  if (action.kind === "create") {
    const payload = ownerContractorPayloadSchema.parse(action.payload);
    return {
      path: "/api/contractors",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    };
  }

  const id = ownerContractorResourceId(action.contractorId);
  if (action.kind === "update") {
    const payload = ownerContractorPayloadSchema.parse(action.payload);
    return {
      path: `/api/contractors/${id}`,
      init: {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    };
  }
  if (action.kind === "archive" || action.kind === "restore") {
    return { path: `/api/contractors/${id}/${action.kind}`, init: { method: "POST" } };
  }
  const suffix = action.kind === "invite" ? "" : `/${action.kind}`;
  return { path: `/api/contractors/${id}/invitation${suffix}`, init: { method: "POST" } };
}

export function parseOwnerTeamMutationResponse(action: OwnerTeamAction, body: unknown): OwnerTeamMutationBody {
  if (action.kind === "create" || action.kind === "update" || action.kind === "archive" || action.kind === "restore") {
    const parsed = ownerContractorSchema.safeParse(body);
    if (!parsed.success) throw new Error("CleanTrack returned an invalid response.");
    return { contractor: parsed.data };
  }
  if (action.kind === "revoke") {
    const parsed = invitationMutationSchema.safeParse(body);
    if (!parsed.success) throw new Error("CleanTrack returned an invalid response.");
    return parsed.data;
  }
  const parsed = invitationIssueSchema.safeParse(body);
  if (!parsed.success) throw new Error("CleanTrack returned an invalid response.");
  return parsed.data;
}

function responseErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function responseFieldErrors(body: unknown): Partial<Record<OwnerContractorFormField, string>> | undefined {
  if (!body || typeof body !== "object" || !("fields" in body) || !body.fields || typeof body.fields !== "object") return undefined;
  const fields: Partial<Record<OwnerContractorFormField, string>> = {};
  for (const key of ["name", "email", "phone", "defaultRateCents"] as const) {
    const value = (body.fields as Record<string, unknown>)[key];
    if (typeof value !== "string") continue;
    fields[key === "defaultRateCents" ? "defaultRate" : key] = value;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function mutationError(status: number, body: unknown): OwnerTeamMutationError {
  const code = responseErrorCode(body);
  if (status === 401 || code === "unauthorized") return { code: "unauthorized", message: OWNER_TEAM_MUTATION_MESSAGES.unauthorized };
  if (status === 404 || code === "not_found") return { code: "not_found", message: OWNER_TEAM_MUTATION_MESSAGES.notFound };
  if (status === 409 && code === "business_required") return { code: "business_required", message: OWNER_TEAM_MUTATION_MESSAGES.businessRequired };
  if (status === 409 && code === "duplicate_contractor") return { code: "duplicate_contractor", message: OWNER_TEAM_MUTATION_MESSAGES.duplicateContractor };
  if (status === 409 && code === "contractor_email_required") return { code: "contractor_email_required", message: OWNER_TEAM_MUTATION_MESSAGES.contractorEmailRequired };
  if (status === 409 && code === "already_linked") return { code: "already_linked", message: OWNER_TEAM_MUTATION_MESSAGES.alreadyLinked };
  if (status === 409 && code === "invitation_exists") return { code: "invitation_exists", message: OWNER_TEAM_MUTATION_MESSAGES.invitationExists };
  if (status === 409 && code === "invitation_not_pending") return { code: "invitation_not_pending", message: OWNER_TEAM_MUTATION_MESSAGES.invitationNotPending };
  if (status === 409 && code === "invitation_conflict") return { code: "invitation_conflict", message: OWNER_TEAM_MUTATION_MESSAGES.invitationConflict };
  if (status === 429 && code === "resend_too_soon") return { code: "resend_too_soon", message: OWNER_TEAM_MUTATION_MESSAGES.resendTooSoon };
  if (status === 400 && code === "invalid_request") {
    return {
      code: "invalid_request",
      message: OWNER_TEAM_MUTATION_MESSAGES.invalidRequest,
      fields: responseFieldErrors(body),
    };
  }
  return { code: "unavailable", message: OWNER_TEAM_MUTATION_MESSAGES.unavailable };
}

export async function runOwnerTeamMutation(action: OwnerTeamAction, send: OwnerTeamMutationSend): Promise<OwnerTeamMutationResult> {
  const request = ownerTeamMutationRequest(action);
  try {
    const response = await send(request.path, request.init);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: mutationError(response.status, response.body) };
    }
    try {
      return { ok: true, body: parseOwnerTeamMutationResponse(action, response.body) };
    } catch {
      return { ok: false, error: { code: "unavailable", message: OWNER_TEAM_MUTATION_MESSAGES.unavailable } };
    }
  } catch {
    return { ok: false, error: { code: "offline", message: OWNER_TEAM_MUTATION_MESSAGES.offline } };
  }
}
