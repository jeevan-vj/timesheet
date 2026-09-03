"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ScheduleEditor, type ScheduleEditorTarget } from "@/components/schedule-editor";
import {
  ASSIGNMENT_LIST_LOAD_ERROR,
  assignmentCreateSuccess,
  assignmentMutationMessage,
  assignmentSuccessMessage,
  canRestoreAssignment,
  createUnassignAssignmentFlow,
  idleUnassignAssignment,
  parseAssignmentOverride,
  presentAssignment,
  restoreAssignmentRequest,
  unassignAssignmentPrompt,
  type AssignmentItemDTO,
  type UnassignAssignmentSession,
  type UnassignAssignmentTarget,
} from "@/lib/assignment-manage";
import { scheduleEditorMode, scheduleSaveSuccess } from "@/lib/schedule-editor";

type ContractorOption = { id: string; name: string };
type SiteOption = { id: string; name: string };

async function send(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "request_failed"); }
  return response;
}

function messageFromError(error: unknown): string {
  return assignmentMutationMessage(error instanceof Error ? error.message : undefined);
}

export function AssignmentManager({
  contractors,
  sites,
  weekStart,
  weekLocked,
  onWeekRefresh,
}: {
  contractors: ContractorOption[];
  sites: SiteOption[];
  weekStart: string;
  weekLocked: boolean;
  onWeekRefresh: () => Promise<void>;
}) {
  const [rows, setRows] = useState<AssignmentItemDTO[] | null>(null);
  const [listError, setListError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"ok" | "error">("ok");
  const [busy, setBusy] = useState(false);
  const [unassignSession, setUnassignSession] = useState<UnassignAssignmentSession>(idleUnassignAssignment);
  const [scheduleTarget, setScheduleTarget] = useState<ScheduleEditorTarget | null>(null);
  const loadGeneration = useRef(0);
  const busyRef = useRef(false);
  const onWeekRefreshRef = useRef(onWeekRefresh);
  onWeekRefreshRef.current = onWeekRefresh;

  const reload = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setListError("");
    try {
      const response = await fetch("/api/assignments", { cache: "no-store" });
      if (response.status === 401) { window.location.assign("/sign-in"); return; }
      if (!response.ok) throw new Error("request_failed");
      const data = await response.json() as { assignments: AssignmentItemDTO[] };
      if (generation !== loadGeneration.current) return;
      setRows(data.assignments);
    } catch {
      if (generation !== loadGeneration.current) return;
      setListError(ASSIGNMENT_LIST_LOAD_ERROR);
    }
  }, []);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => { void reload(); }, [reload]);

  const unassignFlow = useRef(createUnassignAssignmentFlow(async (request) => {
    await send(request.url, undefined, request.method);
    setNoticeKind("ok");
    setNotice(assignmentSuccessMessage.unassigned);
    await Promise.all([reloadRef.current(), onWeekRefreshRef.current()]);
  }, setUnassignSession)).current;

  async function runMutation(task: () => Promise<string | void | Response>, success: string): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setNotice("");
    try {
      const custom = await task();
      setNoticeKind("ok");
      setNotice(typeof custom === "string" ? custom : success);
      await Promise.all([reload(), onWeekRefresh()]);
      return true;
    } catch (error) {
      setNoticeKind("error");
      setNotice(messageFromError(error));
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function confirmUnassign() {
    try {
      await unassignFlow.confirm();
    } catch (error) {
      setNoticeKind("error");
      setNotice(messageFromError(error));
    }
  }

  const loading = rows === null && !listError;
  const empty = rows !== null && rows.length === 0 && !listError;
  const mutating = busy || unassignSession.phase === "submitting";
  const activeContractorIds = contractors.map((row) => row.id);
  const activeSiteIds = sites.map((row) => row.id);

  return <article className="setup-card">
    <div className="setup-title"><h3>Assignments</h3><span>{rows ? rows.length : "…"}</span></div>
    {notice ? <p className={`assignment-notice ${noticeKind === "error" ? "is-error" : "is-ok"}`} role="status">{notice}</p> : null}
    <div className="compact-list">
      {loading ? <p className="assignment-loading" role="status">Loading assignments…</p> : null}
      {listError ? <div className="assignment-notice is-error"><p role="status">{listError}</p><button type="button" className="button tiny secondary" onClick={() => void reload()}>Try again</button></div> : null}
      {empty ? <p className="assignment-empty">No assignments yet. Choose a contractor and a site to connect them.</p> : null}
      {rows?.map((row) => {
        const view = presentAssignment(row);
        const restoreEnabled = canRestoreAssignment(row, activeContractorIds, activeSiteIds);
        return <div className={`compact-row assignment-row${view.archived ? " is-archived" : ""}`} key={row.id}>
          <div className="assignment-row-head">
            <div>
              <strong>{view.heading}</strong>
              <small className="assignment-schedule-summary">{view.detail}</small>
            </div>
            <div className="assignment-row-actions">
              {row.active
                ? <>
                  <button type="button" className="button tiny secondary" aria-label={view.editScheduleLabel} disabled={mutating} onClick={() => setScheduleTarget({ id: row.id, contractorName: row.contractorName, siteName: row.siteName, schedule: row.schedule })}>Edit schedule</button>
                  <button type="button" className="button tiny secondary" aria-label={view.unassignLabel} disabled={mutating} onClick={() => unassignFlow.request({ id: row.id, contractorName: row.contractorName, siteName: row.siteName })}>Unassign</button>
                </>
                : <button type="button" className="button tiny" aria-label={view.restoreLabel} aria-describedby={restoreEnabled ? undefined : `restore-hint-${row.id}`} disabled={mutating || !restoreEnabled} onClick={() => {
                  if (!restoreEnabled) return;
                  const request = restoreAssignmentRequest(row.id);
                  void runMutation(() => send(request.url, undefined, request.method), assignmentSuccessMessage.restored);
                }}>Restore</button>}
            </div>
          </div>
          {!row.active && !restoreEnabled ? <p className="muted assignment-restore-hint" id={`restore-hint-${row.id}`}>{assignmentMutationMessage("not_found")}</p> : null}
          <details>
            <summary>Edit rate</summary>
            <OverrideForm
              assignment={row}
              busy={mutating}
              onInvalid={() => { setNoticeKind("error"); setNotice(assignmentMutationMessage("invalid_request")); }}
              onSave={(rateCents) => void runMutation(
                () => send(`/api/assignments/${row.id}`, { rateCents }, "PATCH"),
                rateCents === null ? assignmentSuccessMessage.rateCleared : assignmentSuccessMessage.rateSaved,
              )}
            />
          </details>
        </div>;
      })}
      <CreateAssignmentForm contractors={contractors} sites={sites} busy={mutating} onSave={(body) => runMutation(async () => assignmentCreateSuccess((await send("/api/assignments", body)).status), assignmentSuccessMessage.created)} onInvalid={() => { setNoticeKind("error"); setNotice(assignmentMutationMessage("invalid_request")); }} />
    </div>
    <UnassignAssignmentDialog session={unassignSession} onCancel={() => unassignFlow.cancel()} onConfirm={() => void confirmUnassign()} />
    <ScheduleEditor
      assignment={scheduleTarget}
      weekStart={weekStart}
      weekLocked={weekLocked}
      onClose={() => setScheduleTarget(null)}
      onSave={async (body) => {
        if (!scheduleTarget) return;
        await send(`/api/assignments/${scheduleTarget.id}/schedule`, body, "PUT");
        setNoticeKind("ok");
        setNotice(scheduleSaveSuccess(scheduleEditorMode(Boolean(scheduleTarget.schedule))));
        await Promise.all([reload(), onWeekRefresh()]);
      }}
    />
  </article>;
}

function OverrideForm({ assignment, busy, onSave, onInvalid }: { assignment: AssignmentItemDTO; busy: boolean; onSave: (rateCents: number | null) => void; onInvalid: () => void }) {
  const [rate, setRate] = useState(assignment.rateCents == null ? "" : (assignment.rateCents / 100).toFixed(2));
  useEffect(() => {
    setRate(assignment.rateCents == null ? "" : (assignment.rateCents / 100).toFixed(2));
  }, [assignment.rateCents]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseAssignmentOverride(rate);
    if (parsed === "invalid") { onInvalid(); return; }
    onSave(parsed);
  }

  return <form className="mini-form" onSubmit={submit}>
    <label>Rate override (NZD)
      <input type="number" inputMode="decimal" min={15} max={250} step="0.01" placeholder="Use default rate" value={rate} onChange={(event) => setRate(event.target.value)} disabled={busy} />
    </label>
    <div className="assignment-rate-actions">
      <button type="button" className="button tiny secondary" disabled={busy} onClick={() => onSave(null)}>Use default</button>
      <button className="button tiny" disabled={busy} aria-busy={busy}>Save</button>
    </div>
  </form>;
}

function CreateAssignmentForm({
  contractors,
  sites,
  busy,
  onSave,
  onInvalid,
}: {
  contractors: ContractorOption[];
  sites: SiteOption[];
  busy: boolean;
  onSave: (body: { contractorId: string; siteId: string; rateCents: number | null }) => Promise<boolean>;
  onInvalid: () => void;
}) {
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const parsed = parseAssignmentOverride(String(data.get("rate") ?? ""));
    if (parsed === "invalid") { onInvalid(); return; }
    const saved = await onSave({ contractorId: String(data.get("contractorId")), siteId: String(data.get("siteId")), rateCents: parsed });
    if (saved) form.reset();
  }

  return <details>
    <summary>+ Assign to site</summary>
    <form className="mini-form" onSubmit={submit}>
      <select name="contractorId" required disabled={busy}>
        <option value="">Choose contractor</option>
        {contractors.map((contractor) => <option key={contractor.id} value={contractor.id}>{contractor.name}</option>)}
      </select>
      <select name="siteId" required disabled={busy}>
        <option value="">Choose site</option>
        {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
      <label>Rate override (optional)
        <input name="rate" type="number" inputMode="decimal" min={15} max={250} step="0.01" placeholder="Use default rate" disabled={busy} />
      </label>
      <button className="button small" disabled={busy || !contractors.length || !sites.length} aria-busy={busy}>Save assignment</button>
    </form>
  </details>;
}

function UnassignAssignmentDialog({ session, onCancel, onConfirm }: { session: UnassignAssignmentSession; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const target: UnassignAssignmentTarget | null = session.target;
  const prompt = target ? unassignAssignmentPrompt(target) : null;
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);
  return <dialog ref={dialogRef} className="modal unassign-assignment-dialog" aria-labelledby="unassign-assignment-title" aria-describedby="unassign-assignment-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">Archive site assignment</p><h2 id="unassign-assignment-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="unassign-assignment-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}
