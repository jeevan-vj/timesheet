"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  createSiteArchiveFlow,
  idleSiteArchive,
  siteArchivePrompt,
  siteRestoreRequest,
  siteRowActions,
  siteSaveErrorMessage,
  sitesListUrl,
  type SiteArchiveSession,
} from "@/lib/site-setup";

type ManagedSite = { id: string; name: string; address: string; active: boolean };

async function sendJson(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.assign("/sign-in");
    throw new Error("unauthorized");
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(data.error ?? "request_failed");
  }
}

export function SiteSetup({ onReload, onAnnounce }: { onReload: () => Promise<void>; onAnnounce: (message: string) => void }) {
  const [sites, setSites] = useState<ManagedSite[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [archiveSession, setArchiveSession] = useState(idleSiteArchive);
  const loadGeneration = useRef(0);
  const runRef = useRef<(action: () => Promise<void>, success: string) => Promise<boolean>>(async () => false);

  const loadSites = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setListStatus("loading");
    const response = await fetch(sitesListUrl(includeArchived), { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/sign-in"); return; }
    if (generation !== loadGeneration.current) return;
    if (!response.ok) { setListStatus("error"); return; }
    setSites(await response.json() as ManagedSite[]);
    setListStatus("ready");
  }, [includeArchived]);

  useEffect(() => { void loadSites(); }, [loadSites]);

  async function runMutation(action: () => Promise<void>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await loadSites();
      await onReload();
      setNotice(success);
      onAnnounce(success);
      return true;
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") return false;
      const message = siteSaveErrorMessage(error);
      setNotice(message);
      onAnnounce(message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  runRef.current = runMutation;

  const archiveFlow = useRef(createSiteArchiveFlow(async (request) => {
    await runRef.current(() => sendJson(request.url, undefined, request.method), "Site archived.");
  }, setArchiveSession)).current;

  async function addSite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const saved = await runMutation(() => sendJson("/api/sites", { name: fields.get("name"), address: fields.get("address") }), "Site added.");
    if (saved) form.reset();
  }

  async function updateSite(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const saved = await runMutation(() => sendJson(`/api/sites/${id}`, { name: fields.get("name"), address: fields.get("address") }, "PATCH"), "Site updated.");
    if (saved) setEditingId(null);
  }

  async function restoreSite(site: ManagedSite) {
    if (busy) return;
    const request = siteRestoreRequest(site);
    await runMutation(() => sendJson(request.url, undefined, request.method), "Site restored.");
  }

  return <div className="site-setup">
    {notice ? <p className={`site-setup-status ${notice.startsWith("Site ") ? "notice" : "alert"}`} role={notice.startsWith("Site ") ? "status" : "alert"}>{notice}</p> : null}
    <label className="show-archived"><input type="checkbox" checked={includeArchived} onChange={(event) => { setIncludeArchived(event.target.checked); setEditingId(null); }} /> Show archived sites</label>
    {listStatus === "loading" && !sites.length ? <p className="muted" role="status">Loading sites…</p> : null}
    {listStatus === "error" ? <p className="alert" role="alert">Could not load sites. Please try again.</p> : null}
    {listStatus === "ready" && !sites.length ? <p className="muted" role="status">No sites yet.</p> : null}
    {sites.map((site) => editingId === site.id
      ? <form className="mini-form site-edit-form compact-row" key={site.id} onSubmit={(event) => void updateSite(event, site.id)}>
          <input name="name" defaultValue={site.name} required maxLength={100} autoFocus aria-label={`Site name for ${site.name}`} />
          <input name="address" defaultValue={site.address} maxLength={240} aria-label={`Address for ${site.name}`} />
          <div className="form-actions site-row-actions">
            <button type="button" className="button secondary small" onClick={() => setEditingId(null)} disabled={busy}>Cancel</button>
            <button className="button small" disabled={busy} aria-busy={busy}>Save</button>
          </div>
        </form>
      : <div className="compact-row site-row" key={site.id}>
          <div className="site-row-top">
            <div>
              <strong>{site.name}</strong>
              <small>{site.address || "No address"}</small>
            </div>
            <span className={`site-status ${site.active ? "is-active" : "is-archived"}`}>{site.active ? "Active" : "Archived"}</span>
          </div>
          <div className="site-row-actions">
            {siteRowActions(site.active).map((action) => action === "edit"
              ? <button type="button" className="button secondary small" key="edit" aria-label={`Edit ${site.name}`} onClick={() => setEditingId(site.id)} disabled={busy}>Edit</button>
              : action === "archive"
                ? <button type="button" className="button secondary small" key="archive" aria-label={`Archive ${site.name}`} onClick={() => archiveFlow.request(site)} disabled={busy}>Archive</button>
                : <button type="button" className="button secondary small" key="restore" aria-label={`Restore ${site.name}`} onClick={() => void restoreSite(site)} disabled={busy}>Restore</button>)}
          </div>
        </div>)}
    <details>
      <summary>+ Add site</summary>
      <form className="mini-form" onSubmit={(event) => void addSite(event)}>
        <input name="name" placeholder="Site name" required maxLength={100} aria-label="Site name" />
        <input name="address" placeholder="Address (optional)" maxLength={240} aria-label="Site address" />
        <button className="button small" disabled={busy} aria-busy={busy}>Save site</button>
      </form>
    </details>
    <ArchiveSiteDialog session={archiveSession} onCancel={() => archiveFlow.cancel()} onConfirm={() => void archiveFlow.confirm()} />
  </div>;
}

function ArchiveSiteDialog({ session, onCancel, onConfirm }: { session: SiteArchiveSession; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const target = session.target;
  const prompt = target ? siteArchivePrompt(target) : null;
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);
  return <dialog ref={dialogRef} className="modal delete-shift-dialog archive-site-dialog" aria-labelledby="archive-site-title" aria-describedby="archive-site-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">Archive site</p><h2 id="archive-site-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="archive-site-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}
