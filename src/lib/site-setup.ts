export type SiteArchiveTarget = {
  id: string;
  name: string;
};

export type SiteArchiveSession =
  | { phase: "idle"; target: null }
  | { phase: "confirming"; target: SiteArchiveTarget }
  | { phase: "submitting"; target: SiteArchiveTarget };

export type SiteArchiveRequest = { method: "DELETE"; url: string };
export type SiteRestoreRequest = { method: "POST"; url: string };
export type SiteRowAction = "edit" | "archive" | "restore";

export const idleSiteArchive: SiteArchiveSession = { phase: "idle", target: null };

export function sitesListUrl(includeArchived = false): string {
  return includeArchived ? "/api/sites?includeArchived=1" : "/api/sites";
}

export function requestSiteArchive(target: SiteArchiveTarget): Extract<SiteArchiveSession, { phase: "confirming" }> {
  return { phase: "confirming", target };
}

export function cancelSiteArchive(): SiteArchiveSession {
  return idleSiteArchive;
}

export function siteArchiveRequest(target: SiteArchiveTarget): SiteArchiveRequest {
  return { method: "DELETE", url: `/api/sites/${target.id}` };
}

export function siteRestoreRequest(target: SiteArchiveTarget): SiteRestoreRequest {
  return { method: "POST", url: `/api/sites/${target.id}/restore` };
}

export function siteArchivePrompt(target: SiteArchiveTarget) {
  return {
    title: "Archive this site?",
    description: `${target.name} will be archived. Current assignments for this site will be deactivated. Historical shifts stay.`,
    confirmLabel: "Archive site",
    cancelLabel: "Cancel",
    closeLabel: "Close archive confirmation",
  };
}

export function siteRowActions(active: boolean): SiteRowAction[] {
  return active ? ["edit", "archive"] : ["edit", "restore"];
}

export function siteSaveErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "duplicate_site") return "This workspace already has a site with that name.";
  if (code === "invalid_request") return "Check the name (1–100 characters) and address (max 240 characters).";
  if (code === "not_found") return "That site is no longer available.";
  return "Could not save this site. Check your connection and try again.";
}

export function createSiteArchiveFlow(
  sendDelete: (request: SiteArchiveRequest) => Promise<void>,
  onChange?: (session: SiteArchiveSession) => void,
) {
  let session: SiteArchiveSession = idleSiteArchive;
  const setSession = (next: SiteArchiveSession) => {
    session = next;
    onChange?.(session);
  };

  return {
    getSession() {
      return session;
    },
    request(target: SiteArchiveTarget) {
      setSession(requestSiteArchive(target));
    },
    cancel() {
      if (session.phase === "submitting") return;
      setSession(idleSiteArchive);
    },
    async confirm() {
      if (session.phase !== "confirming") return;
      const target = session.target;
      setSession({ phase: "submitting", target });
      try {
        await sendDelete(siteArchiveRequest(target));
      } finally {
        setSession(idleSiteArchive);
      }
    },
  };
}
