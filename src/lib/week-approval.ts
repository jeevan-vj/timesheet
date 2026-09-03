export type WeekApprovalStatus = "open" | "approved" | "reopened";

export type WeekApproval = {
  status: WeekApprovalStatus;
  approvedAt: string | null;
  reopenedAt: string | null;
};

export type WeekApprovalSession =
  | { phase: "idle" }
  | { phase: "confirming-approve" }
  | { phase: "confirming-reopen" }
  | { phase: "submitting"; kind: "approve" | "reopen" };

export type WeekApproveBody = {
  weekStart: string;
  expectedPaidMinutes: number;
  expectedPayCents: number;
};

export type WeekApproveRequest = {
  method: "POST";
  url: "/api/weeks/approve";
  body: WeekApproveBody;
};

export type WeekReopenRequest = {
  method: "POST";
  url: "/api/weeks/reopen";
  body: { weekStart: string };
};

export type WeekApprovalHttpRequest = WeekApproveRequest | WeekReopenRequest;

export const idleWeekApproval: WeekApprovalSession = { phase: "idle" };

export function weekApprovalBadgeLabel(status: WeekApprovalStatus): "Open" | "Approved & locked" | "Reopened" {
  if (status === "approved") return "Approved & locked";
  if (status === "reopened") return "Reopened";
  return "Open";
}

export function canApproveWeek(status: WeekApprovalStatus): boolean {
  return status === "open" || status === "reopened";
}

export function canReopenWeek(status: WeekApprovalStatus): boolean {
  return status === "approved";
}

export function weekApproveRequest(input: WeekApproveBody): WeekApproveRequest {
  return {
    method: "POST",
    url: "/api/weeks/approve",
    body: {
      weekStart: input.weekStart,
      expectedPaidMinutes: input.expectedPaidMinutes,
      expectedPayCents: input.expectedPayCents,
    },
  };
}

export function weekReopenRequest(input: { weekStart: string }): WeekReopenRequest {
  return {
    method: "POST",
    url: "/api/weeks/reopen",
    body: { weekStart: input.weekStart },
  };
}

export function weekApprovePrompt(input: { weekRangeLabel: string; paidDurationLabel: string; payLabel: string }) {
  return {
    title: "Approve this week?",
    description: `${input.weekRangeLabel} has ${input.paidDurationLabel} paid and ${input.payLabel} NZD gross pay. Approving locks this week so shifts cannot be changed until it is reopened.`,
    confirmLabel: "Approve week",
    cancelLabel: "Cancel",
    closeLabel: "Close approve confirmation",
  };
}

export function weekReopenPrompt(input: { weekRangeLabel: string }) {
  return {
    title: "Reopen this week?",
    description: `Reopen ${input.weekRangeLabel} so shifts can be edited again.`,
    confirmLabel: "Reopen week",
    cancelLabel: "Cancel",
    closeLabel: "Close reopen confirmation",
  };
}

export function weekApprovalErrorMessage(code: string): string {
  if (code === "week_locked") return "This week is approved and locked. Reopen it before changing shifts.";
  if (code === "stale_week") return "This week's hours or pay changed. Reload and review again.";
  if (code === "week_not_approved") return "This week is not approved yet.";
  return "That could not be saved. Check for a duplicate or missing assignment.";
}

export function expectedWeekTotals(summary: { paidMinutes: number; payCents: number }[]) {
  return {
    expectedPaidMinutes: summary.reduce((sum, row) => sum + row.paidMinutes, 0),
    expectedPayCents: summary.reduce((sum, row) => sum + row.payCents, 0),
  };
}

export function weekApprovalPendingKind(session: WeekApprovalSession): "approve" | "reopen" | null {
  if (session.phase === "confirming-approve") return "approve";
  if (session.phase === "confirming-reopen") return "reopen";
  if (session.phase === "submitting") return session.kind;
  return null;
}

export function cancelWeekApproval(): WeekApprovalSession {
  return idleWeekApproval;
}

export function createWeekApprovalFlow(
  send: (request: WeekApprovalHttpRequest) => Promise<void>,
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
    requestApprove() {
      if (session.phase === "submitting") return;
      setSession({ phase: "confirming-approve" });
    },
    requestReopen() {
      if (session.phase === "submitting") return;
      setSession({ phase: "confirming-reopen" });
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleWeekApproval);
    },
    async confirm(input: WeekApproveBody) {
      if (session.phase !== "confirming-approve" && session.phase !== "confirming-reopen") return;
      const kind = session.phase === "confirming-approve" ? "approve" as const : "reopen" as const;
      setSession({ phase: "submitting", kind });
      try {
        await send(kind === "approve" ? weekApproveRequest(input) : weekReopenRequest({ weekStart: input.weekStart }));
      } finally {
        setSession(idleWeekApproval);
      }
    },
  };
}
