"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AssignmentManager } from "@/components/assignments";
import { authClient } from "@/lib/auth-client";
import { ContractorsPanel } from "@/components/contractors";
import { ShiftEntrySheet } from "@/components/shift-entry";
import { SiteSetup } from "@/components/site-setup";
import { AddRepeatingSchedule, WeekGrid } from "@/components/week-grid";
import { assignmentMutationMessage } from "@/lib/assignment-manage";
import {
  createRemittanceDownloadFlow,
  idleRemittanceDownload,
  remittanceDownloadFilename,
  remittanceDownloadPrompt,
  remittanceErrorMessage,
  type RemittanceDownloadSession,
  type RemittanceDownloadTarget,
} from "@/lib/remittance-download";
import { createShiftDeleteFlow, idleShiftDelete, shiftDeletePrompt, type ShiftDeleteSession } from "@/lib/shift-delete";
import { applyThenDashboardUrls, shouldApplySchedule } from "@/lib/week-load";
import { buildWeekGridRows, weekGridIsEmpty } from "@/lib/week-grid";
import {
  canApproveWeek,
  canReopenWeek,
  createWeekApprovalFlow,
  expectedWeekTotals,
  idleWeekApproval,
  weekApprovalBadgeLabel,
  weekApprovalErrorMessage,
  weekApprovalPendingKind,
  weekApprovePrompt,
  weekReopenPrompt,
  type WeekApproval,
  type WeekApprovalSession,
  type WeekApprovalStatus,
} from "@/lib/week-approval";

type Site = { id: string; name: string; address: string };
type Contractor = { id: string; name: string; email: string; phone: string; defaultRateCents: number; currency: string };
type AssignmentSchedule = { id: string; weekdays: number[]; paidMinutes: number; effectiveFrom: string };
type Assignment = { id: string; contractorId: string; siteId: string; rateCents: number | null; schedule: AssignmentSchedule | null };
type Entry = {
  id: string;
  contractorId: string;
  contractorName: string;
  siteId: string;
  siteName: string;
  workDate: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes: number;
  paidMinutes: number;
  rateCents: number;
  notes: string;
  entryMode: "clock" | "paid_hours" | "absent";
  occurrenceKind: "manual" | "scheduled" | "absent" | "hours_override";
  scheduleVersionId: string | null;
};
type ManualEntry = Entry & { entryMode: "clock" | "paid_hours"; occurrenceKind: "manual" };
type Summary = { contractorId: string; contractorName: string; paidMinutes: number; payCents: number };
type DashboardData = { weekStart: string; weekEnd: string; sites: Site[]; contractors: Contractor[]; assignments: Assignment[]; entries: Entry[]; summary: Summary[]; approval: WeekApproval };

function mondayFor(date = new Date()): string {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7; value.setUTCDate(value.getUTCDate() - day + 1); return value.toISOString().slice(0, 10);
}
function shiftWeek(week: string, days: number): string { const value = new Date(`${week}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function money(cents: number) { return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100); }
function duration(minutes: number) { return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`; }
function readableDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)); }
function fullDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); }
function mutateErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "invalid_shift") return "Finish time and break must leave a positive paid shift.";
  if (code === "week_locked" || code === "stale_week" || code === "week_not_approved") return weekApprovalErrorMessage(code);
  if (code === "schedule_exists" || code === "no_schedule" || code === "invalid_week") return assignmentMutationMessage(code);
  return "That could not be saved. Check for a duplicate or missing assignment.";
}

async function send(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "request_failed"); }
}

async function saveRemittancePdf(url: string, target: RemittanceDownloadTarget) {
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 401) { window.location.assign("/sign-in"); return false; }
  if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "request_failed"); }
  const blob = await response.blob();
  const filename = remittanceDownloadFilename(response.headers.get("Content-Disposition"), target);
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
  return true;
}

export function Dashboard() {
  const [week, setWeek] = useState(() => mondayFor()); const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true); const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<ManualEntry | null>(null);
  const loadGeneration = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    if (!quiet) { setLoading(true); setMessage(""); }
    const urls = applyThenDashboardUrls(week);
    const response = await fetch(urls.dashboard, { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/sign-in"); return; }
    if (generation !== loadGeneration.current) return;
    if (!response.ok) {
      if (!quiet) setMessage("Could not load this week. Please try again.");
      setLoading(false);
      return;
    }
    let next = await response.json() as DashboardData;
    let applyNotice = "";
    if (shouldApplySchedule(next.approval.status)) {
      try {
        await send("/api/weeks/apply-schedule", { weekStart: week });
      } catch (error) {
        applyNotice = mutateErrorMessage(error);
      }
      const refreshed = await fetch(urls.dashboard, { cache: "no-store" });
      if (refreshed.status === 401) { window.location.assign("/sign-in"); return; }
      if (generation !== loadGeneration.current) return;
      if (refreshed.ok) next = await refreshed.json() as DashboardData;
    }
    if (generation !== loadGeneration.current) return;
    setData(next);
    setLoading(false);
    if (applyNotice) setMessage(applyNotice);
  }, [week]);
  useEffect(() => { void load(); }, [load]);
  const totalMinutes = data?.summary.reduce((sum, row) => sum + row.paidMinutes, 0) ?? 0;
  const totalPay = data?.summary.reduce((sum, row) => sum + row.payCents, 0) ?? 0;

  async function mutate(action: () => Promise<void>, success: string) {
    try {
      setMessage("");
      await action();
      await load(true);
      setMessage(success);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(mutateErrorMessage(error));
      if (code === "stale_week") await load(true);
    }
  }
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const [deleteSession, setDeleteSession] = useState(idleShiftDelete);
  const deleteFlow = useRef(createShiftDeleteFlow(async (request) => {
    await mutateRef.current(() => send(request.url, undefined, request.method), "Shift removed.");
  }, setDeleteSession)).current;
  const [approvalSession, setApprovalSession] = useState(idleWeekApproval);
  const approvalFlow = useRef(createWeekApprovalFlow(async (request) => {
    const success = request.url === "/api/weeks/approve" ? "Week approved." : request.url === "/api/weeks/reopen" ? "Week reopened." : "Saved.";
    await mutateRef.current(() => send(request.url, request.body, request.method), success);
  }, setApprovalSession)).current;
  const weekLocked = data?.approval.status === "approved";
  const pendingKind = weekApprovalPendingKind(approvalSession);
  const weekRangeLabel = data ? `${readableDate(data.weekStart)} – ${readableDate(data.weekEnd)}` : "";
  const approvalPrompt = data && pendingKind === "approve"
    ? weekApprovePrompt({ weekRangeLabel, paidDurationLabel: duration(totalMinutes), payLabel: money(totalPay) })
    : data && pendingKind === "reopen"
      ? weekReopenPrompt({ weekRangeLabel })
      : null;
  const [remittanceSession, setRemittanceSession] = useState(idleRemittanceDownload);
  const remittanceSessionRef = useRef(idleRemittanceDownload);
  const remittanceFlow = useRef(createRemittanceDownloadFlow(async (request) => {
    const target = remittanceSessionRef.current.target;
    if (!target) return;
    try {
      setMessage("");
      const saved = await saveRemittancePdf(request.url, target);
      if (saved) setMessage("Remittance downloaded.");
    } catch (error) {
      setMessage(remittanceErrorMessage(error instanceof Error ? error.message : ""));
    }
  }, (session) => {
    remittanceSessionRef.current = session;
    setRemittanceSession(session);
  })).current;

  return <main className="app-shell">
    <header className="app-header"><a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a><nav><a href="#team">Team & sites</a><button className="link-button" onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}>Sign out</button></nav></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Weekly workspace</p><h1>Hours & contractor pay</h1><p className="muted">Gross contractor payments before tax, GST, expenses, or adjustments.</p></div><div className="week-heading-tools"><WeekPicker week={week} onChange={setWeek} />{!loading && data ? <WeekApprovalBar status={data.approval.status} onApprove={() => approvalFlow.requestApprove()} onReopen={() => approvalFlow.requestReopen()} /> : null}</div></section>
    {message ? <p className="notice" role="status">{message}</p> : null}
    {loading || !data ? <section className="loading-card">Loading your week…</section> : <>
      <section className="stats"><article><span>Paid hours</span><strong>{duration(totalMinutes)}</strong><small>{data.entries.length} daily {data.entries.length === 1 ? "entry" : "entries"}</small></article><article><span>Contractor pay</span><strong>{money(totalPay)}</strong><small>{data.summary.length} {data.summary.length === 1 ? "contractor" : "contractors"}</small></article><article><span>Active sites</span><strong>{data.sites.length}</strong><small>{data.assignments.length} team assignments</small></article></section>
      <section className="main-grid">
        <section className="panel"><div className="panel-title"><div><p className="eyebrow">Monday – Sunday</p><h2>{readableDate(data.weekStart)} – {readableDate(data.weekEnd)}</h2></div><div className="week-panel-tools"><AddRepeatingSchedule assignments={data.assignments} contractors={data.contractors} sites={data.sites} weekStart={data.weekStart} locked={weekLocked} onSave={async (assignmentId, body) => { await send(`/api/assignments/${assignmentId}/schedule`, body, "PUT"); await load(true); setMessage("Repeating schedule added."); }} /><ShiftEntrySheet data={data} locked={weekLocked} onSave={async (body) => { await send("/api/time-entries", body); await load(true); setMessage("Shift added."); }} /></div></div>
          {weekGridIsEmpty(buildWeekGridRows({ assignments: data.assignments, contractors: data.contractors, sites: data.sites, entries: data.entries }), data.entries) ? <EmptyState title="No shifts this week" body="Record the first shift after adding a contractor and assigning them to a site." /> : <WeekGrid weekStart={data.weekStart} assignments={data.assignments} contractors={data.contractors} sites={data.sites} entries={data.entries} locked={weekLocked} onEdit={(entry) => { if (entry.occurrenceKind !== "manual" || entry.entryMode === "absent") return; setEditing(entry as ManualEntry); }} onDelete={(target) => deleteFlow.request(target)} onException={async (url, body) => { try { await send(url, body); await load(true); setMessage("Timesheet updated."); } catch (error) { setMessage(mutateErrorMessage(error)); throw error; } }} />}
        </section>
        <aside className="panel summary-panel"><p className="eyebrow">Payment summary</p><h2>What to pay</h2>{data.summary.length ? <>{data.summary.map((row) => <div className="summary-row" key={row.contractorId}><div><strong>{row.contractorName}</strong><small>{duration(row.paidMinutes)}</small><button type="button" className="button small secondary" aria-label={`Download remittance for ${row.contractorName}`} onClick={() => remittanceFlow.request({ contractorId: row.contractorId, contractorName: row.contractorName, weekStart: data.weekStart, weekEnd: data.weekEnd })}>Remittance</button></div><b>{money(row.payCents)}</b></div>)}<div className="summary-total"><span>Total</span><strong>{money(totalPay)}</strong></div></> : <p className="muted roomy">Payment totals appear as shifts are added.</p>}</aside>
      </section>
      <SetupPanel data={data} weekLocked={weekLocked} onReload={() => load(true)} onAnnounce={setMessage} />
    </>}
    {editing && data && !weekLocked ? <ShiftEntrySheet key={editing.id} data={data} entry={editing} onDismiss={() => setEditing(null)} onSave={async (body) => { await send(`/api/time-entries/${editing.id}`, body, "PATCH"); await load(true); setMessage("Shift updated."); }} /> : null}
    <DeleteShiftDialog session={deleteSession} onCancel={() => deleteFlow.cancel()} onConfirm={() => void deleteFlow.confirm()} />
    <WeekApprovalDialog session={approvalSession} prompt={approvalPrompt} onCancel={() => approvalFlow.cancel()} onConfirm={() => { if (!data) return; void approvalFlow.confirm({ weekStart: data.weekStart, ...expectedWeekTotals(data.summary) }); }} />
    <RemittanceDownloadDialog session={remittanceSession} onCancel={() => remittanceFlow.cancel()} onConfirm={() => void remittanceFlow.confirm()} />
  </main>;
}

function WeekApprovalBar({ status, onApprove, onReopen }: { status: WeekApprovalStatus; onApprove: () => void; onReopen: () => void }) {
  const label = weekApprovalBadgeLabel(status);
  return <div className="week-approval-bar">
    <span className={`week-approval-badge is-${status}`} aria-label={`Week status: ${label}`}>{label}</span>
    {canApproveWeek(status) ? <button type="button" className="button small" onClick={onApprove}>Approve week</button> : null}
    {canReopenWeek(status) ? <button type="button" className="button small secondary" onClick={onReopen}>Reopen week</button> : null}
  </div>;
}

function DeleteShiftDialog({ session, onCancel, onConfirm }: { session: ShiftDeleteSession; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const target = session.target;
  const prompt = target ? shiftDeletePrompt(target, fullDate(target.workDate)) : null;
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);
  return <dialog ref={dialogRef} className="modal delete-shift-dialog" aria-labelledby="delete-shift-title" aria-describedby="delete-shift-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">Remove recorded hours</p><h2 id="delete-shift-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="delete-shift-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}

function WeekApprovalDialog({ session, prompt, onCancel, onConfirm }: { session: WeekApprovalSession; prompt: ReturnType<typeof weekApprovePrompt> | null; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const open = session.phase !== "idle";
  const kind = weekApprovalPendingKind(session);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);
  return <dialog ref={dialogRef} className="modal week-approval-dialog" aria-labelledby="week-approval-title" aria-describedby="week-approval-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">{kind === "reopen" ? "Unlock this week" : "Lock this week"}</p><h2 id="week-approval-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="week-approval-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}

function RemittanceDownloadDialog({ session, onCancel, onConfirm }: { session: RemittanceDownloadSession; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const target = session.target;
  const prompt = target ? remittanceDownloadPrompt(target, `${readableDate(target.weekStart)} – ${readableDate(target.weekEnd)}`) : null;
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);
  return <dialog ref={dialogRef} className="modal delete-shift-dialog" aria-labelledby="remittance-download-title" aria-describedby="remittance-download-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">Weekly remittance</p><h2 id="remittance-download-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="remittance-download-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}

function WeekPicker({ week, onChange }: { week: string; onChange: (value: string) => void }) {
  return <div className="week-picker"><button onClick={() => onChange(shiftWeek(week, -7))} aria-label="Previous week">←</button><label>Week of<input type="date" value={week} onChange={(e) => onChange(mondayFor(new Date(`${e.target.value}T12:00:00`)))} /></label><button onClick={() => onChange(shiftWeek(week, 7))} aria-label="Next week">→</button></div>;
}

function SetupPanel({ data, weekLocked, onReload, onAnnounce }: { data: DashboardData; weekLocked: boolean; onReload: () => Promise<void>; onAnnounce: (message: string) => void }) {
  return <section className="setup" id="team"><div><p className="eyebrow">Workspace setup</p><h2>Team & cleaning sites</h2><p className="muted">Add each contractor and site once, then connect them with the right rate.</p></div><div className="setup-grid"><SetupCard title="Sites" count={data.sites.length}><SiteSetup onReload={onReload} onAnnounce={onAnnounce} /></SetupCard><ContractorsPanel onNotice={onAnnounce} onChanged={onReload} /><AssignmentManager contractors={data.contractors} sites={data.sites} weekStart={data.weekStart} weekLocked={weekLocked} onWeekRefresh={onReload} /></div></section>;
}
function SetupCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <article className="setup-card"><div className="setup-title"><h3>{title}</h3><span>{count}</span></div><div className="compact-list">{children}</div></article>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty"><span>◷</span><h3>{title}</h3><p>{body}</p></div>; }
