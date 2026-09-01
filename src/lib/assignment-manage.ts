import { formatNzd, parseRateDollars } from "@/lib/shift-entry";

export type AssignmentItemDTO = {
  id: string;
  contractorId: string;
  contractorName: string;
  siteId: string;
  siteName: string;
  rateCents: number | null;
  effectiveRateCents: number;
  rateInherited: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type UnassignAssignmentTarget = {
  id: string;
  contractorName: string;
  siteName: string;
};

export type UnassignAssignmentSession =
  | { phase: "idle"; target: null }
  | { phase: "confirming"; target: UnassignAssignmentTarget }
  | { phase: "submitting"; target: UnassignAssignmentTarget };

export type UnassignAssignmentRequest = { method: "DELETE"; url: string };

export const idleUnassignAssignment: UnassignAssignmentSession = { phase: "idle", target: null };

export const ASSIGNMENT_LIST_LOAD_ERROR = "Could not load assignments. Please try again.";

export const assignmentSuccessMessage = {
  created: "Assignment added.",
  restored: "Assignment restored.",
  unassigned: "Assignment archived.",
  rateSaved: "Rate override saved.",
  rateCleared: "Future entries will use the contractor default.",
} as const;

export function requestUnassignAssignment(target: UnassignAssignmentTarget): Extract<UnassignAssignmentSession, { phase: "confirming" }> {
  return { phase: "confirming", target };
}

export function cancelUnassignAssignment(): UnassignAssignmentSession {
  return idleUnassignAssignment;
}

export function unassignAssignmentRequest(id: string): UnassignAssignmentRequest {
  return { method: "DELETE", url: `/api/assignments/${id}` };
}

export function restoreAssignmentRequest(id: string) {
  return { method: "POST" as const, url: `/api/assignments/${id}/restore` };
}

export function unassignAssignmentPrompt(target: UnassignAssignmentTarget) {
  return {
    title: "Unassign this contractor?",
    description: `${target.contractorName} at ${target.siteName}. Recorded shifts stay on the timesheet. This only archives the assignment.`,
    confirmLabel: "Unassign",
    cancelLabel: "Cancel",
    closeLabel: "Close unassign confirmation",
  };
}

export function createUnassignAssignmentFlow(
  sendDelete: (request: UnassignAssignmentRequest) => Promise<void>,
  onChange?: (session: UnassignAssignmentSession) => void,
) {
  let session: UnassignAssignmentSession = idleUnassignAssignment;
  const setSession = (next: UnassignAssignmentSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    request(target: UnassignAssignmentTarget) {
      setSession(requestUnassignAssignment(target));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleUnassignAssignment);
    },
    async confirm() {
      if (session.phase !== "confirming") return;
      const target = session.target;
      setSession({ phase: "submitting", target });
      try {
        await sendDelete(unassignAssignmentRequest(target.id));
      } finally {
        setSession(idleUnassignAssignment);
      }
    },
  };
}

export function assignmentStatusLabel(active: boolean): "Active" | "Archived" {
  return active ? "Active" : "Archived";
}

export function assignmentRateLabel(input: { rateInherited: boolean; effectiveRateCents: number }): string {
  const amount = formatNzd(input.effectiveRateCents);
  return input.rateInherited ? `${amount}/hr default` : `${amount}/hr override`;
}

export function presentAssignment(item: AssignmentItemDTO) {
  return {
    id: item.id,
    contractorName: item.contractorName,
    siteName: item.siteName,
    heading: `${item.contractorName} → ${item.siteName}`,
    rateLabel: assignmentRateLabel(item),
    statusLabel: assignmentStatusLabel(item.active),
    archived: !item.active,
    unassignLabel: `Unassign ${item.contractorName} from ${item.siteName}`,
    restoreLabel: `Restore ${item.contractorName} at ${item.siteName}`,
  };
}

export function canRestoreAssignment(
  assignment: { contractorId: string; siteId: string; active?: boolean },
  activeContractorIds: readonly string[],
  activeSiteIds: readonly string[],
): boolean {
  if (assignment.active) return false;
  return activeContractorIds.includes(assignment.contractorId) && activeSiteIds.includes(assignment.siteId);
}

export function assignmentMutationMessage(errorCode: string | undefined): string {
  if (errorCode === "duplicate_assignment") return "That contractor is already assigned to this site.";
  if (errorCode === "not_found") return "That contractor or site is missing or inactive.";
  if (errorCode === "invalid_request") return "Check the rate is between NZ$15 and NZ$250.";
  return "That assignment could not be saved. Please try again.";
}

export function parseAssignmentOverride(value: string): number | null | "invalid" {
  return parseRateDollars(value);
}
