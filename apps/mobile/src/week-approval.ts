import { weekApproveInput, weekReopenInput } from "@cleantrack/core";

export type OwnerWeekApprovalAction = "approve" | "reopen";

export type OwnerWeekApprovalInput =
  | { action: "approve"; weekStart: string; expectedPaidMinutes: number; expectedPayCents: number }
  | { action: "reopen"; weekStart: string };

export type OwnerWeekApprovalCode =
  | "stale_week"
  | "week_locked"
  | "week_not_approved"
  | "unauthorized"
  | "invalid_request"
  | "offline"
  | "unavailable";

export type OwnerWeekApprovalError = { code: OwnerWeekApprovalCode; message: string };

export type OwnerWeekApprovalResult =
  | { ok: true; body: unknown }
  | { ok: false; error: OwnerWeekApprovalError };

type RequestInit = {
  method: "POST";
  headers: { "content-type": "application/json" };
  body: string;
};

export type OwnerWeekApprovalSend = (
  path: "/api/weeks/approve" | "/api/weeks/reopen",
  init: RequestInit,
) => Promise<{ status: number; body: unknown }>;

export const OWNER_WEEK_APPROVAL_MESSAGES = {
  staleWeek: "Totals changed. Review the refreshed week and approve again.",
  weekLocked: "This week is already approved and locked.",
  weekNotApproved: "This week is no longer approved. Refresh and review it again.",
  unauthorized: "Your session ended. Sign in again.",
  invalidRequest: "The week or totals are no longer valid. Refresh and try again.",
  offline: "You're offline. Check your connection and try again.",
  unavailable: "CleanTrack couldn't update this week. Try again.",
} as const;

function responseCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function approvalError(status: number, body: unknown): OwnerWeekApprovalError {
  const code = responseCode(body);
  if (status === 401 || code === "unauthorized") {
    return { code: "unauthorized", message: OWNER_WEEK_APPROVAL_MESSAGES.unauthorized };
  }
  if (status === 409 && code === "stale_week") {
    return { code: "stale_week", message: OWNER_WEEK_APPROVAL_MESSAGES.staleWeek };
  }
  if (status === 409 && code === "week_locked") {
    return { code: "week_locked", message: OWNER_WEEK_APPROVAL_MESSAGES.weekLocked };
  }
  if (status === 409 && code === "week_not_approved") {
    return { code: "week_not_approved", message: OWNER_WEEK_APPROVAL_MESSAGES.weekNotApproved };
  }
  if (status === 400 && (code === "invalid_request" || code === "invalid_week")) {
    return { code: "invalid_request", message: OWNER_WEEK_APPROVAL_MESSAGES.invalidRequest };
  }
  return { code: "unavailable", message: OWNER_WEEK_APPROVAL_MESSAGES.unavailable };
}

export function ownerWeekApprovalRequest(input: OwnerWeekApprovalInput): {
  path: "/api/weeks/approve" | "/api/weeks/reopen";
  init: RequestInit;
} {
  const parsed = input.action === "approve"
    ? weekApproveInput.safeParse(input)
    : weekReopenInput.safeParse(input);
  if (!parsed.success) {
    const mondayIssue = parsed.error.issues.some((issue) => issue.path.includes("weekStart"));
    throw new Error(mondayIssue ? "Week must start on Monday." : "Week totals are invalid.");
  }
  const body = input.action === "approve"
    ? {
        weekStart: input.weekStart,
        expectedPaidMinutes: input.expectedPaidMinutes,
        expectedPayCents: input.expectedPayCents,
      }
    : { weekStart: input.weekStart };
  return {
    path: input.action === "approve" ? "/api/weeks/approve" : "/api/weeks/reopen",
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  };
}

export async function runOwnerWeekApproval(
  input: OwnerWeekApprovalInput,
  send: OwnerWeekApprovalSend,
): Promise<OwnerWeekApprovalResult> {
  const request = ownerWeekApprovalRequest(input);
  try {
    const response = await send(request.path, request.init);
    if (response.status >= 200 && response.status < 300) return { ok: true, body: response.body };
    return { ok: false, error: approvalError(response.status, response.body) };
  } catch {
    return { ok: false, error: { code: "offline", message: OWNER_WEEK_APPROVAL_MESSAGES.offline } };
  }
}
