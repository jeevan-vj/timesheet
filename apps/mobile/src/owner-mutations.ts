import type { OwnerApprovalStatus, OwnerEntry } from "@cleantrack/core";

export type OwnerShiftAction = "worked" | "did_not_work" | "reset_pending" | "change_hours";

export type OwnerShiftExceptionBody =
  | { kind: "confirm_worked"; scope: "this_day" }
  | { kind: "absent"; scope: "this_day" }
  | { kind: "worked_as_scheduled"; scope: "this_day" }
  | { kind: "hours_override"; paidMinutes: number; scope: "this_day" };

export type OwnerShiftActionAvailability = {
  action: OwnerShiftAction;
  label: string;
  enabled: boolean;
  reason: string | null;
};

export type OwnerShiftActionsState = {
  actions: OwnerShiftActionAvailability[];
  reason: string | null;
};

export type OwnerShiftMutationCode =
  | "week_locked"
  | "no_schedule"
  | "not_found"
  | "unauthorized"
  | "invalid_request"
  | "duplicate_entry"
  | "offline"
  | "unavailable";

export type OwnerShiftMutationError = {
  code: OwnerShiftMutationCode;
  message: string;
};

export type OwnerShiftMutationResult =
  | { ok: true; body: unknown }
  | { ok: false; error: OwnerShiftMutationError };

export type OwnerShiftMutationSend = (
  path: string,
  init: { method: "POST"; headers: { "content-type": "application/json" }; body: string },
) => Promise<{ status: number; body: unknown }>;

const ACTIONS: ReadonlyArray<{
  action: OwnerShiftAction;
  label: string;
  currentKind: OwnerEntry["occurrenceKind"] | null;
  currentReason: string | null;
}> = [
  { action: "worked", label: "Worked", currentKind: "worked", currentReason: "This shift is already marked worked." },
  { action: "did_not_work", label: "Didn't work", currentKind: "absent", currentReason: "This shift is already marked didn't work." },
  { action: "reset_pending", label: "Reset to pending", currentKind: "scheduled", currentReason: "This shift is already pending." },
  { action: "change_hours", label: "Change hours (this day only)", currentKind: null, currentReason: null },
];

export const OWNER_SHIFT_MUTATION_MESSAGES = {
  weekLocked: "This week is approved and locked. Reopen it on the web before changing shifts.",
  noSchedule: "This shift has no repeating schedule, so it can only be changed on the web.",
  notFound: "This shift could not be found. Refresh and try again.",
  unauthorized: "Your session ended. Sign in again.",
  invalidRequest: "Those hours aren't valid.",
  duplicateEntry: "Another shift already exists for this contractor, site, and day.",
  offline: "You're offline. Check your connection and try again.",
  unavailable: "CleanTrack couldn't change this shift. Try again.",
} as const;

const INVALID_PAID_MINUTES = "Enter a whole number of minutes from 1 to 1439.";

function responseErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function mutationError(status: number, body: unknown): OwnerShiftMutationError {
  const responseCode = responseErrorCode(body);
  if (status === 401 || responseCode === "unauthorized") {
    return { code: "unauthorized", message: OWNER_SHIFT_MUTATION_MESSAGES.unauthorized };
  }
  if (status === 404 || responseCode === "not_found") {
    return { code: "not_found", message: OWNER_SHIFT_MUTATION_MESSAGES.notFound };
  }
  if (status === 409 && responseCode === "week_locked") {
    return { code: "week_locked", message: OWNER_SHIFT_MUTATION_MESSAGES.weekLocked };
  }
  if (status === 409 && responseCode === "no_schedule") {
    return { code: "no_schedule", message: OWNER_SHIFT_MUTATION_MESSAGES.noSchedule };
  }
  if (status === 409 && responseCode === "duplicate_entry") {
    return { code: "duplicate_entry", message: OWNER_SHIFT_MUTATION_MESSAGES.duplicateEntry };
  }
  if (status === 400 && responseCode === "invalid_request") {
    return { code: "invalid_request", message: OWNER_SHIFT_MUTATION_MESSAGES.invalidRequest };
  }
  return { code: "unavailable", message: OWNER_SHIFT_MUTATION_MESSAGES.unavailable };
}

function ownerShiftResourceId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error("This shift is not available.");
  return id;
}

export function ownerShiftExceptionPath(id: string): string {
  return `/api/time-entries/${ownerShiftResourceId(id)}/exception`;
}

export function ownerShiftPaidMinutesError(paidMinutes: number | undefined): string | null {
  if (paidMinutes == null || !Number.isInteger(paidMinutes) || paidMinutes < 1 || paidMinutes > 1_439) {
    return INVALID_PAID_MINUTES;
  }
  return null;
}

export function ownerShiftExceptionBody(
  action: OwnerShiftAction,
  paidMinutes?: number,
): OwnerShiftExceptionBody {
  if (action === "worked") return { kind: "confirm_worked", scope: "this_day" };
  if (action === "did_not_work") return { kind: "absent", scope: "this_day" };
  if (action === "reset_pending") return { kind: "worked_as_scheduled", scope: "this_day" };
  const validationMessage = ownerShiftPaidMinutesError(paidMinutes);
  if (validationMessage || paidMinutes == null) throw new Error(validationMessage ?? INVALID_PAID_MINUTES);
  return { kind: "hours_override", paidMinutes, scope: "this_day" };
}

export function ownerShiftActionsState(
  entry: Pick<OwnerEntry, "occurrenceKind">,
  approvalStatus: OwnerApprovalStatus,
): OwnerShiftActionsState {
  if (entry.occurrenceKind === "manual") {
    return { actions: [], reason: "One-off shifts can be changed on the web dashboard." };
  }
  const lockedReason = approvalStatus === "approved" ? OWNER_SHIFT_MUTATION_MESSAGES.weekLocked : null;
  return {
    actions: ACTIONS.map(({ action, label, currentKind, currentReason: alreadyReason }) => {
      const currentReason = currentKind === entry.occurrenceKind ? alreadyReason : null;
      return {
        action,
        label,
        enabled: lockedReason == null && currentReason == null,
        reason: lockedReason ?? currentReason,
      };
    }),
    reason: lockedReason,
  };
}

export async function runOwnerShiftException(
  entryId: string,
  action: OwnerShiftAction,
  paidMinutes: number | undefined,
  send: OwnerShiftMutationSend,
): Promise<OwnerShiftMutationResult> {
  const path = ownerShiftExceptionPath(entryId);
  const body = ownerShiftExceptionBody(action, paidMinutes);
  try {
    const response = await send(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status >= 200 && response.status < 300) return { ok: true, body: response.body };
    return { ok: false, error: mutationError(response.status, response.body) };
  } catch {
    return { ok: false, error: { code: "offline", message: OWNER_SHIFT_MUTATION_MESSAGES.offline } };
  }
}
