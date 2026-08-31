export type ShiftDeleteTarget = {
  id: string;
  contractorName: string;
  siteName: string;
  workDate: string;
};

export type ShiftDeleteSession =
  | { phase: "idle"; target: null }
  | { phase: "confirming"; target: ShiftDeleteTarget }
  | { phase: "submitting"; target: ShiftDeleteTarget };

export type ShiftDeleteRequest = { method: "DELETE"; url: string };

export const idleShiftDelete: ShiftDeleteSession = { phase: "idle", target: null };

export function requestShiftDelete(target: ShiftDeleteTarget): ShiftDeleteSession {
  return { phase: "confirming", target };
}

export function cancelShiftDelete(): ShiftDeleteSession {
  return idleShiftDelete;
}

export function shiftDeleteRequest(target: ShiftDeleteTarget): ShiftDeleteRequest {
  return { method: "DELETE", url: `/api/time-entries/${target.id}` };
}

export function shiftDeletePrompt(target: ShiftDeleteTarget, workDateLabel: string) {
  return {
    title: "Delete this shift?",
    description: `${target.contractorName} at ${target.siteName} on ${workDateLabel}. This removes the recorded hours from the week.`,
    confirmLabel: "Delete shift",
    cancelLabel: "Cancel",
    closeLabel: "Close delete confirmation",
  };
}

export function createShiftDeleteFlow(
  sendDelete: (request: ShiftDeleteRequest) => Promise<void>,
  onChange?: (session: ShiftDeleteSession) => void,
) {
  let session: ShiftDeleteSession = idleShiftDelete;
  const setSession = (next: ShiftDeleteSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    request(target: ShiftDeleteTarget) {
      setSession(requestShiftDelete(target));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleShiftDelete);
    },
    async confirm() {
      if (session.phase !== "confirming") return;
      const target = session.target;
      setSession({ phase: "submitting", target });
      try {
        await sendDelete(shiftDeleteRequest(target));
      } finally {
        setSession(idleShiftDelete);
      }
    },
  };
}
