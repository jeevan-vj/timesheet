import {
  portalShiftSubmissionSchema,
  tasksForShifts,
  type PortalShiftSubmission,
  type PortalWeekSubmission,
} from "@cleantrack/core/portal";

export const CONTRACTOR_SHIFT_ACTIONS = [
  { action: "worked_as_scheduled", label: "Worked as scheduled" },
  { action: "absent", label: "Didn't work" },
  { action: "different_hours", label: "Worked different hours" },
] as const;

export type ContractorShiftAction = (typeof CONTRACTOR_SHIFT_ACTIONS)[number]["action"];

export type ContractorShiftEditor =
  | { mode: "edit" }
  | { mode: "locked"; message: string }
  | { mode: "unrecorded"; message: string }
  | { mode: "employer_recorded"; message: string }
  | { mode: "future"; message: string };

export type ContractorShiftMutationCode =
  | "week_locked"
  | "no_schedule"
  | "not_found"
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "offline"
  | "unavailable"
  | "future_shift";

export type ContractorShiftMutationError = {
  code: ContractorShiftMutationCode;
  message: string;
};

export type ContractorShiftMutationResult =
  | { ok: true; shift: PortalShiftSubmission }
  | { ok: false; error: ContractorShiftMutationError };

export type ContractorShiftStatusBody =
  | { action: "worked_as_scheduled" }
  | { action: "absent" }
  | { action: "different_hours"; paidMinutes: number; reason?: string };

export type ContractorShiftMutationSend = (
  path: string,
  init: { method: "POST"; headers: { "content-type": "application/json" }; body: string },
) => Promise<{ status: number; body: unknown }>;

export const CONTRACTOR_SHIFT_MESSAGES = {
  locked: "This week is approved and locked, so this status can't be changed.",
  unrecorded: "This shift is still on the schedule and has not been recorded yet, so the status can't be changed.",
  employerRecorded: "This shift was recorded by your employer. The status can't be changed here.",
  weekLocked: "This week is approved and locked, so this status can't be changed.",
  noSchedule: "This shift can't be updated from My week.",
  notFound: "This shift could not be updated. Refresh and try again.",
  unauthorized: "Your session ended. Sign in again.",
  forbidden: "CleanTrack couldn't change this shift. Try again.",
  invalidRequest: "Those hours aren't valid.",
  offline: "You're offline. Nothing was saved. Check your connection and try again.",
  unavailable: "That update didn't save. Try again.",
  future: "You can update this shift once the day has started.",
  invalidMinutes: "Enter a whole number of minutes from 1 to 1439.",
} as const;

const SHIFT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function contractorShiftEditor(shift: {
  id?: string;
  workDate?: string;
  locked?: boolean;
  recorded?: boolean;
  occurrenceKind: PortalShiftSubmission["occurrenceKind"];
}, today?: string): ContractorShiftEditor {
  if (shift.locked === true) return { mode: "locked", message: CONTRACTOR_SHIFT_MESSAGES.locked };
  if (today && shift.workDate && shift.workDate > today) return { mode: "future", message: CONTRACTOR_SHIFT_MESSAGES.future };
  const recorded = shift.recorded ?? (shift.id == null || !shift.id.startsWith("sched_"));
  if (!recorded) return { mode: "unrecorded", message: CONTRACTOR_SHIFT_MESSAGES.unrecorded };
  if (shift.occurrenceKind === "manual") return { mode: "employer_recorded", message: CONTRACTOR_SHIFT_MESSAGES.employerRecorded };
  return { mode: "edit" };
}

export function contractorShiftPaidMinutesError(paidMinutes: number): string | null {
  if (!Number.isInteger(paidMinutes) || paidMinutes < 1 || paidMinutes > 1439) return CONTRACTOR_SHIFT_MESSAGES.invalidMinutes;
  return null;
}

export function contractorShiftStatusBody(
  action: ContractorShiftAction,
  input?: { paidMinutes?: number; reason?: string },
): ContractorShiftStatusBody {
  if (action === "worked_as_scheduled") return { action };
  if (action === "absent") return { action };
  const paidMinutes = input?.paidMinutes;
  const validationMessage = contractorShiftPaidMinutesError(paidMinutes ?? Number.NaN);
  if (validationMessage || paidMinutes == null) throw new Error(validationMessage ?? CONTRACTOR_SHIFT_MESSAGES.invalidMinutes);
  const reason = input?.reason?.trim() ?? "";
  if (reason.length > 200) throw new Error(CONTRACTOR_SHIFT_MESSAGES.invalidRequest);
  return reason.length > 0 ? { action, paidMinutes, reason } : { action, paidMinutes };
}

export function contractorShiftStatusPath(id: string): string {
  if (!SHIFT_ID.test(id)) throw new Error(CONTRACTOR_SHIFT_MESSAGES.notFound);
  return `/api/portal/shifts/${id}`;
}

function responseErrorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function mutationError(status: number, body: unknown): ContractorShiftMutationError {
  const responseCode = responseErrorCode(body);
  if (status === 401 || responseCode === "unauthorized") {
    return { code: "unauthorized", message: CONTRACTOR_SHIFT_MESSAGES.unauthorized };
  }
  if (status === 403 || responseCode === "forbidden") {
    return { code: "forbidden", message: CONTRACTOR_SHIFT_MESSAGES.forbidden };
  }
  if (status === 404 || responseCode === "not_found") {
    return { code: "not_found", message: CONTRACTOR_SHIFT_MESSAGES.notFound };
  }
  if (status === 409 && responseCode === "week_locked") {
    return { code: "week_locked", message: CONTRACTOR_SHIFT_MESSAGES.weekLocked };
  }
  if (status === 409 && responseCode === "future_shift") {
    return { code: "future_shift", message: CONTRACTOR_SHIFT_MESSAGES.future };
  }
  if (status === 409 && responseCode === "no_schedule") {
    return { code: "no_schedule", message: CONTRACTOR_SHIFT_MESSAGES.noSchedule };
  }
  if (status === 400 && responseCode === "invalid_request") {
    return { code: "invalid_request", message: CONTRACTOR_SHIFT_MESSAGES.invalidRequest };
  }
  return { code: "unavailable", message: CONTRACTOR_SHIFT_MESSAGES.unavailable };
}

export function statusAfterAttempt(
  previous: Pick<PortalShiftSubmission, "occurrenceKind">,
  result: ContractorShiftMutationResult,
): PortalShiftSubmission["occurrenceKind"] {
  if (!result.ok) return previous.occurrenceKind;
  return result.shift.occurrenceKind;
}

export function replacePortalShift(
  current: PortalWeekSubmission | undefined,
  shift: PortalShiftSubmission,
): PortalWeekSubmission | undefined {
  if (!current) return current;
  const days = current.days.map((day) => ({
    ...day,
    shifts: day.shifts.map((item) => item.id === shift.id ? shift : item),
  }));
  return {
    ...current,
    days,
    tasks: tasksForShifts(days.flatMap((day) => day.shifts)),
  };
}

export async function runContractorShiftStatus(
  entryId: string,
  action: ContractorShiftAction,
  input: { paidMinutes?: number; reason?: string } | undefined,
  send: ContractorShiftMutationSend,
  options?: { online?: boolean },
): Promise<ContractorShiftMutationResult> {
  if (options?.online === false) {
    return { ok: false, error: { code: "offline", message: CONTRACTOR_SHIFT_MESSAGES.offline } };
  }
  try {
    const body = contractorShiftStatusBody(action, input);
    const response = await send(contractorShiftStatusPath(entryId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, error: mutationError(response.status, response.body) };
    }
    const parsed = portalShiftSubmissionSchema.safeParse(response.body);
    if (!parsed.success) return { ok: false, error: { code: "unavailable", message: CONTRACTOR_SHIFT_MESSAGES.unavailable } };
    return { ok: true, shift: parsed.data };
  } catch (error) {
    if (error instanceof TypeError) {
      return { ok: false, error: { code: "offline", message: CONTRACTOR_SHIFT_MESSAGES.offline } };
    }
    return { ok: false, error: { code: "unavailable", message: CONTRACTOR_SHIFT_MESSAGES.unavailable } };
  }
}
