export type RemittanceDownloadTarget = {
  contractorId: string;
  contractorName: string;
  weekStart: string;
  weekEnd: string;
};

export type RemittanceDownloadSession =
  | { phase: "idle"; target: null }
  | { phase: "confirming"; target: RemittanceDownloadTarget }
  | { phase: "submitting"; target: RemittanceDownloadTarget };

export type RemittanceDownloadRequest = { method: "GET"; url: string };

export const idleRemittanceDownload: RemittanceDownloadSession = { phase: "idle", target: null };

export function requestRemittanceDownload(target: RemittanceDownloadTarget): Extract<RemittanceDownloadSession, { phase: "confirming" }> {
  return { phase: "confirming", target };
}

export function cancelRemittanceDownload(): RemittanceDownloadSession {
  return idleRemittanceDownload;
}

export function remittanceDownloadUrl(target: RemittanceDownloadTarget): string {
  return `/api/contractors/${target.contractorId}/remittance?week=${target.weekStart}`;
}

export function remittanceDownloadRequest(target: RemittanceDownloadTarget): RemittanceDownloadRequest {
  return { method: "GET", url: remittanceDownloadUrl(target) };
}

export function remittanceDownloadPrompt(target: RemittanceDownloadTarget, weekLabel: string) {
  return {
    title: "Download remittance?",
    description: `Download remittance for ${target.contractorName} for Monday–Sunday ${weekLabel}.`,
    confirmLabel: "Download remittance",
    cancelLabel: "Cancel",
    closeLabel: "Close remittance confirmation",
  };
}

export function remittanceErrorMessage(error: string): string {
  if (error === "no_entries") return "No shifts for that contractor this week.";
  if (error === "invalid_week") return "That week is invalid.";
  if (error === "missing_remitter") return "Your account name and email are missing.";
  if (error === "not_found") return "Could not find that contractor. Refresh and try again.";
  return "Cannot generate remittance.";
}

export function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const quoted = /filename\s*=\s*"([^"]+)"/i.exec(header);
  if (quoted?.[1]) return quoted[1];
  const plain = /filename\s*=\s*([^;]+)/i.exec(header);
  const value = plain?.[1]?.trim();
  return value || null;
}

export function createRemittanceDownloadFlow(
  download: (request: RemittanceDownloadRequest) => Promise<void>,
  onChange?: (session: RemittanceDownloadSession) => void,
) {
  let session: RemittanceDownloadSession = idleRemittanceDownload;
  const setSession = (next: RemittanceDownloadSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    request(target: RemittanceDownloadTarget) {
      setSession(requestRemittanceDownload(target));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleRemittanceDownload);
    },
    async confirm() {
      if (session.phase !== "confirming") return;
      const target = session.target;
      setSession({ phase: "submitting", target });
      try {
        await download(remittanceDownloadRequest(target));
      } finally {
        setSession(idleRemittanceDownload);
      }
    },
  };
}
