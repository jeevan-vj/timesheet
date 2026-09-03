export type WeekApprovalResource = {
  status: "open" | "approved";
  approvedAt: string | null;
  reopenedAt: string | null;
};

export type WeekApprovalAction = "approve" | "reopen";

export type WeekApprovalTarget = {
  weekStart: string;
  weekRangeLabel: string;
  paidHoursLabel: string;
  payLabel: string;
  expectedPaidMinutes: number;
  expectedPayCents: number;
};

export type WeekApprovalSession =
  | { phase: "idle"; action: null; target: null }
  | { phase: "confirm-approve"; action: "approve"; target: WeekApprovalTarget }
  | { phase: "confirm-reopen"; action: "reopen"; target: WeekApprovalTarget }
  | { phase: "submitting"; action: WeekApprovalAction; target: WeekApprovalTarget };

export type WeekApprovalRequest = {
  method: "POST";
  url: string;
  body: { expectedPaidMinutes: number; expectedPayCents: number };
};

export const idleWeekApproval: WeekApprovalSession = { phase: "idle", action: null, target: null };

export const weekApprovalSuccessMessage = {
  approved: "Week approved and locked.",
  reopened: "Week reopened.",
} as const;

export function requestApprove(target: WeekApprovalTarget): Extract<WeekApprovalSession, { phase: "confirm-approve" }> {
  return { phase: "confirm-approve", action: "approve", target };
}

export function requestReopen(target: WeekApprovalTarget): Extract<WeekApprovalSession, { phase: "confirm-reopen" }> {
  return { phase: "confirm-reopen", action: "reopen", target };
}

export function cancelWeekApproval(): WeekApprovalSession {
  return idleWeekApproval;
}

export function weekApprovalRequest(action: WeekApprovalAction, target: WeekApprovalTarget): WeekApprovalRequest {
  return {
    method: "POST",
    url: `/api/weeks/${target.weekStart}/${action}`,
    body: {
      expectedPaidMinutes: target.expectedPaidMinutes,
      expectedPayCents: target.expectedPayCents,
    },
  };
}

export function weekApprovalPrompt(action: WeekApprovalAction, target: Pick<WeekApprovalTarget, "weekRangeLabel" | "paidHoursLabel" | "payLabel">) {
  const range = `${target.weekRangeLabel} (Monday–Sunday)`;
  const totals = `${target.paidHoursLabel} paid and ${target.payLabel} gross contractor pay`;
  if (action === "approve") {
    return {
      title: "Approve this week?",
      description: `Approve ${range} with ${totals}. This locks recorded shifts so they cannot be added, edited, or deleted.`,
      confirmLabel: "Approve week",
      cancelLabel: "Cancel",
      closeLabel: "Close approve confirmation",
    };
  }
  return {
    title: "Reopen this week?",
    description: `Reopen ${range} with ${totals}. This unlocks the week so shifts can be added, edited, or deleted again.`,
    confirmLabel: "Reopen week",
    cancelLabel: "Cancel",
    closeLabel: "Close reopen confirmation",
  };
}

export function weekApprovalStatusView(
  approval: WeekApprovalResource,
  reopenedAtLabel?: string,
): { label: "Open" | "Approved / locked"; note: string | null } {
  if (approval.status === "approved") return { label: "Approved / locked", note: null };
  if (approval.reopenedAt) {
    return { label: "Open", note: reopenedAtLabel ? `Last reopened ${reopenedAtLabel}` : "Last reopened" };
  }
  return { label: "Open", note: null };
}

export function weekMutationErrorMessage(code: string): string | null {
  if (code === "week_locked") return "This week is locked. Reopen it to add, edit, or delete shifts.";
  if (code === "week_already_approved") return "This week is already approved. Refresh to see the current status.";
  if (code === "week_not_approved") return "This week is not approved. Refresh to see the current status.";
  if (code === "stale_week_totals") return "Hours or pay changed. Refresh and confirm again.";
  return null;
}

export function dashboardMutationMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return weekMutationErrorMessage(code)
    ?? (code === "invalid_shift"
      ? "Finish time and break must leave a positive paid shift."
      : "That could not be saved. Check for a duplicate or missing assignment.");
}

export function createWeekApprovalFlow(
  sendRequest: (request: WeekApprovalRequest) => Promise<void>,
  onChange?: (session: WeekApprovalSession) => void,
) {
  let session: WeekApprovalSession = idleWeekApproval;
  const setSession = (next: WeekApprovalSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    requestApprove(next: WeekApprovalTarget) {
      setSession(requestApprove(next));
    },
    requestReopen(next: WeekApprovalTarget) {
      setSession(requestReopen(next));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleWeekApproval);
    },
    async confirm() {
      if (session.phase !== "confirm-approve" && session.phase !== "confirm-reopen") return;
      const { action, target } = session;
      setSession({ phase: "submitting", action, target });
      try {
        await sendRequest(weekApprovalRequest(action, target));
      } finally {
        setSession(idleWeekApproval);
      }
    },
  };
}
