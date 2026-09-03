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

export type SiteListItem = { id: string; name: string; address: string; active: boolean };
export type SiteListResult =
  | { status: "unauthorized" }
  | { status: "ready"; sites: SiteListItem[] }
  | { status: "error" };
export type SiteMutationResult =
  | { ok: true }
  | { ok: false; phase: "save" | "refresh"; error: unknown };

export const SITE_REFRESH_ERROR = "Saved, but the site list could not be refreshed. Reload if the list looks out of date.";

export function siteSaveErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "duplicate_site") return "This workspace already has a site with that name.";
  if (code === "invalid_request") return "Check the name (1–100 characters) and address (max 240 characters).";
  if (code === "not_found") return "That site is no longer available.";
  return "Could not save this site. Check your connection and try again.";
}

export async function readSiteList(fetchList: () => Promise<Response>): Promise<SiteListResult> {
  try {
    const response = await fetchList();
    if (response.status === 401) return { status: "unauthorized" };
    if (!response.ok) return { status: "error" };
    const sites = await response.json();
    if (!Array.isArray(sites)) return { status: "error" };
    return { status: "ready", sites };
  } catch {
    return { status: "error" };
  }
}

export async function completeSiteMutation(
  save: () => Promise<void>,
  refresh: () => Promise<void>,
): Promise<SiteMutationResult> {
  try {
    await save();
  } catch (error) {
    return { ok: false, phase: "save", error };
  }
  try {
    await refresh();
  } catch (error) {
    return { ok: false, phase: "refresh", error };
  }
  return { ok: true };
}

export function siteMutationFeedback(result: SiteMutationResult, success: string) {
  if (result.ok) return { message: success, saved: true, kind: "success" as const };
  if (result.error instanceof Error && result.error.message === "unauthorized") {
    return { message: "", saved: false, kind: "silent" as const };
  }
  if (result.phase === "refresh") return { message: SITE_REFRESH_ERROR, saved: true, kind: "warning" as const };
  return { message: siteSaveErrorMessage(result.error), saved: false, kind: "error" as const };
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
