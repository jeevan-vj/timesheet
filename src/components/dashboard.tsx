"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AssignmentManager } from "@/components/assignments";
import { RoleSwitcher } from "@/components/role-switcher";
import { useViewerGate } from "@/components/viewer-gate";
import { authClient } from "@/lib/auth-client";
import { ContractorsPanel } from "@/components/contractors";
import { ShiftEntrySheet } from "@/components/shift-entry";
import { SiteSetup } from "@/components/site-setup";
import { AddRepeatingSchedule, WeekGrid } from "@/components/week-grid";
import { mondayFor, mondayFromInput, shiftWeek, thisWeekSelection } from "@/components/week-picker";
import { assignmentMutationMessage } from "@/lib/assignment-manage";
import { onboardingAdvancesOnError, onboardingStep, type OnboardingStep } from "@/lib/onboarding";
import {
  createRemittanceDownloadFlow,
  idleRemittanceDownload,
  remittanceDownloadFilename,
  remittanceDownloadPrompt,
  remittanceErrorMessage,
  type RemittanceDownloadSession,
  type RemittanceDownloadTarget,
} from "@/lib/remittance-download";
import { createShiftDeleteFlow, idleShiftDelete, shiftDeletePrompt, type ShiftDeleteSession, type ShiftDeleteTarget } from "@/lib/shift-delete";
import { applyThenDashboardUrls, shouldApplySchedule } from "@/lib/week-load";
import { buildWeekGridRows, weekGridIsEmpty, type WeekGridEntry } from "@/lib/week-grid";
import { formatMinutes, formatNzd, formatWeekBrief, summarizeWeekBySite, type SiteWeek } from "@/lib/week-rollup";
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
type BusinessProfile = {
  id: string;
  name: string;
  nzbn: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  currency: string;
  weekStart: string;
  onboardingCompletedAt: string | null;
};
type DashboardData = { weekStart: string; weekEnd: string; sites: Site[]; contractors: Contractor[]; assignments: Assignment[]; entries: Entry[]; summary: Summary[]; approval: WeekApproval; business: BusinessProfile | null };

function duration(minutes: number) { return formatMinutes(minutes); }
function money(cents: number) { return formatNzd(cents); }
function readableDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)); }
function fullDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); }
function mutateErrorMessage(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "invalid_shift") return "Finish time and break must leave a positive paid shift.";
  if (code === "week_locked" || code === "stale_week" || code === "week_not_approved") return weekApprovalErrorMessage(code);
  if (code === "schedule_exists" || code === "no_schedule" || code === "invalid_week") return assignmentMutationMessage(code);
  return "That could not be saved. Check for a duplicate or missing assignment.";
}

async function send(url: string, body?: unknown, method = "POST", signal?: AbortSignal) {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined, signal });
  if (response.status === 401) { window.location.assign("/sign-in"); throw new Error("unauthorized"); }
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState<ManualEntry | null>(null);
  const gate = useViewerGate();
  const loadGeneration = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const load = useCallback(async (quiet = false) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    if (!quiet) { setLoading(true); setMessage(""); }
    setLoadFailed(false);
    const urls = applyThenDashboardUrls(week);
    try {
      const response = await fetch(urls.dashboard, { cache: "no-store", signal: controller.signal });
      if (response.status === 401) { window.location.assign("/sign-in"); return; }
      if (generation !== loadGeneration.current) return;
      if (!response.ok) throw new Error("refresh_failed");
      let next = await response.json() as DashboardData;
      let applyNotice = "";
      if (shouldApplySchedule(next.approval.status, next.assignments)) {
        try {
          await send("/api/weeks/apply-schedule", { weekStart: week }, "POST", controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          applyNotice = mutateErrorMessage(error);
        }
        const refreshed = await fetch(urls.dashboard, { cache: "no-store", signal: controller.signal });
        if (refreshed.status === 401) { window.location.assign("/sign-in"); return; }
        if (generation !== loadGeneration.current) return;
        if (!refreshed.ok) throw new Error("refresh_failed");
        next = await refreshed.json() as DashboardData;
      }
      if (generation !== loadGeneration.current) return;
      setData(next);
      setLoading(false);
      if (applyNotice) setMessage(applyNotice);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (generation !== loadGeneration.current) return;
      setData(null);
      setLoadFailed(true);
      setLoading(false);
    }
  }, [week]);
  useEffect(() => { if (gate.ready) void load(); }, [load, gate.ready]);
  const onboarding = data ? onboardingStep({
    business: data.business,
    activeSiteCount: data.sites.length,
    activeContractorCount: data.contractors.length,
    activeAssignmentCount: data.assignments.length,
  }) : null;
  const totalMinutes = data?.summary.reduce((sum, row) => sum + row.paidMinutes, 0) ?? 0;
  const totalPay = data?.summary.reduce((sum, row) => sum + row.payCents, 0) ?? 0;
  const siteSummary = data ? summarizeWeekBySite(data.entries) : [];
  async function copyWeekBrief() {
    if (!data) return;
    const text = formatWeekBrief({
      weekStart: data.weekStart,
      weekEnd: data.weekEnd,
      contractors: data.summary.map((row) => ({ name: row.contractorName, paidMinutes: row.paidMinutes, payCents: row.payCents })),
      sites: siteSummary.map((row) => ({ name: row.siteName, paidMinutes: row.paidMinutes, payCents: row.payCents })),
    });
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Week brief copied.");
    } catch {
      setMessage("Could not copy the week brief.");
    }
  }

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
    {gate.viewer ? <RoleSwitcher viewer={gate.viewer} current="dashboard" /> : null}
    <section className="dashboard-heading"><div><p className="eyebrow">Weekly workspace</p><h1>Hours & contractor pay</h1><p className="muted">Gross contractor payments before tax, GST, expenses, or adjustments.</p></div><div className="week-heading-tools"><WeekPicker week={week} onChange={setWeek} />{!loading && data ? <WeekApprovalBar status={data.approval.status} onApprove={() => approvalFlow.requestApprove()} onReopen={() => approvalFlow.requestReopen()} /> : null}</div></section>
    {message ? <p className="notice" role="status">{message}</p> : null}
    {loading ? <section className="loading-card" role="status">Loading your week…</section> : loadFailed || !data ? <section className="loading-card" role="alert"><p>Could not refresh this week. Any confirmed changes are saved.</p><button type="button" className="button" onClick={() => void load()}>Try again</button></section> : <LoadedWeek data={data} onboarding={onboarding} totalMinutes={totalMinutes} totalPay={totalPay} siteSummary={siteSummary} weekLocked={weekLocked} editing={editing} onReload={() => load(true)} onAnnounce={setMessage} onCopyWeekBrief={() => void copyWeekBrief()} onEdit={setEditing} onDelete={(target) => deleteFlow.request(target)} onRemittance={(target) => remittanceFlow.request(target)} />}
    <DeleteShiftDialog session={deleteSession} onCancel={() => deleteFlow.cancel()} onConfirm={() => void deleteFlow.confirm()} />
    <WeekApprovalDialog session={approvalSession} prompt={approvalPrompt} onCancel={() => approvalFlow.cancel()} onConfirm={() => { if (!data) return; void approvalFlow.confirm({ weekStart: data.weekStart, ...expectedWeekTotals(data.summary) }); }} />
    <RemittanceDownloadDialog session={remittanceSession} onCancel={() => remittanceFlow.cancel()} onConfirm={() => void remittanceFlow.confirm()} />
  </main>;
}

function noun(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function LoadedWeek({ data, onboarding, totalMinutes, totalPay, siteSummary, weekLocked, editing, onReload, onAnnounce, onCopyWeekBrief, onEdit, onDelete, onRemittance }: Readonly<{
  data: DashboardData;
  onboarding: OnboardingStep | null;
  totalMinutes: number;
  totalPay: number;
  siteSummary: SiteWeek[];
  weekLocked: boolean;
  editing: ManualEntry | null;
  onReload: () => Promise<void>;
  onAnnounce: (message: string) => void;
  onCopyWeekBrief: () => void;
  onEdit: (entry: ManualEntry | null) => void;
  onDelete: (target: ShiftDeleteTarget) => void;
  onRemittance: (target: RemittanceDownloadTarget) => void;
}>) {
  return <>
    {onboarding ? <OwnerOnboarding step={onboarding} onReload={onReload} onAnnounce={onAnnounce} /> : null}
    <section className="stats"><article><span>Paid hours</span><strong>{duration(totalMinutes)}</strong><small>{noun(data.entries.length, "daily entry", "daily entries")}</small></article><article><span>Contractor pay</span><strong>{money(totalPay)}</strong><small>{noun(data.summary.length, "contractor", "contractors")}</small></article><article><span>Active sites</span><strong>{data.sites.length}</strong><small>{data.assignments.length} team assignments</small></article></section>
    <section className="main-grid">
      <WeekEntries data={data} weekLocked={weekLocked} onReload={onReload} onAnnounce={onAnnounce} onEdit={onEdit} onDelete={onDelete} />
      <PaySummary data={data} totalPay={totalPay} siteSummary={siteSummary} onCopyWeekBrief={onCopyWeekBrief} onRemittance={onRemittance} />
    </section>
    <SetupPanel data={data} weekLocked={weekLocked} onReload={onReload} onAnnounce={onAnnounce} />
    {editing && !weekLocked ? <ShiftEntrySheet key={editing.id} data={data} entry={editing} onDismiss={() => onEdit(null)} onSave={async (body) => { await send(`/api/time-entries/${editing.id}`, body, "PATCH"); await onReload(); onAnnounce("Shift updated."); }} /> : null}
  </>;
}

function openManualEntry(entry: WeekGridEntry, onEdit: (entry: ManualEntry | null) => void) {
  if (entry.occurrenceKind !== "manual" || entry.entryMode === "absent") return;
  onEdit(entry as ManualEntry);
}

function WeekEntries({ data, weekLocked, onReload, onAnnounce, onEdit, onDelete }: Readonly<{
  data: DashboardData;
  weekLocked: boolean;
  onReload: () => Promise<void>;
  onAnnounce: (message: string) => void;
  onEdit: (entry: ManualEntry | null) => void;
  onDelete: (target: ShiftDeleteTarget) => void;
}>) {
  const rows = buildWeekGridRows({ assignments: data.assignments, contractors: data.contractors, sites: data.sites, entries: data.entries });
  return <section className="panel"><div className="panel-title"><div><p className="eyebrow">Monday – Sunday</p><h2>{readableDate(data.weekStart)} – {readableDate(data.weekEnd)}</h2></div><div className="week-panel-tools"><AddRepeatingSchedule assignments={data.assignments} contractors={data.contractors} sites={data.sites} weekStart={data.weekStart} locked={weekLocked} onSave={async (assignmentId, body) => { await send(`/api/assignments/${assignmentId}/schedule`, body, "PUT"); await onReload(); onAnnounce("Repeating schedule added."); }} /><ShiftEntrySheet data={data} locked={weekLocked} onSave={async (body) => { await send("/api/time-entries", body); await onReload(); onAnnounce("Shift added."); }} /></div></div>
    {weekGridIsEmpty(rows, data.entries) ? <EmptyState title="No shifts this week" body="Record the first shift after adding a contractor and assigning them to a site." /> : <WeekGrid weekStart={data.weekStart} assignments={data.assignments} contractors={data.contractors} sites={data.sites} entries={data.entries} locked={weekLocked} onEdit={(entry) => openManualEntry(entry, onEdit)} onDelete={onDelete} onException={async (url, body) => { try { await send(url, body); await onReload(); onAnnounce("Timesheet updated."); } catch (error) { onAnnounce(mutateErrorMessage(error)); throw error; } }} />}
  </section>;
}

function PaySummary({ data, totalPay, siteSummary, onCopyWeekBrief, onRemittance }: Readonly<{
  data: DashboardData;
  totalPay: number;
  siteSummary: SiteWeek[];
  onCopyWeekBrief: () => void;
  onRemittance: (target: RemittanceDownloadTarget) => void;
}>) {
  return <aside className="panel summary-panel">
    <div className="summary-heading"><div><p className="eyebrow">Payment summary</p><h2>What to pay</h2></div><button type="button" className="button small secondary summary-copy" data-feature="copy-week-brief" onClick={onCopyWeekBrief}>Copy week brief</button></div>
    {data.summary.length ? <>{data.summary.map((row) => <div className="summary-row" key={row.contractorId}><div><strong>{row.contractorName}</strong><small>{duration(row.paidMinutes)}</small><button type="button" className="button small secondary" aria-label={`Download remittance for ${row.contractorName}`} onClick={() => onRemittance({ contractorId: row.contractorId, contractorName: row.contractorName, weekStart: data.weekStart, weekEnd: data.weekEnd })}>Remittance</button></div><b>{money(row.payCents)}</b></div>)}<div className="summary-total"><span>Total</span><strong>{money(totalPay)}</strong></div></> : <p className="muted roomy">Payment totals appear as shifts are added.</p>}
    <div className="site-summary" data-feature="week-site-summary"><h3 className="summary-subhead">By site</h3>{siteSummary.length ? siteSummary.map((row) => <div className="summary-row" key={row.siteId}><div><strong>{row.siteName}</strong><small>{duration(row.paidMinutes)}</small></div><b>{money(row.payCents)}</b></div>) : <p className="muted">Site totals appear as shifts are added.</p>}</div>
  </aside>;
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
  return <div className="week-picker"><button type="button" onClick={() => onChange(shiftWeek(week, -7))} aria-label="Previous week">←</button><button type="button" className="this-week" onClick={() => onChange(thisWeekSelection(week))}>This week</button><label>Week of<input type="date" value={week} onChange={(e) => { const next = mondayFromInput(e.target.value); if (next) onChange(next); }} /></label><button type="button" onClick={() => onChange(shiftWeek(week, 7))} aria-label="Next week">→</button></div>;
}

function SetupPanel({ data, weekLocked, onReload, onAnnounce }: { data: DashboardData; weekLocked: boolean; onReload: () => Promise<void>; onAnnounce: (message: string) => void }) {
  return <section className="setup" id="team"><div><p className="eyebrow">Workspace setup</p><h2>Team & cleaning sites</h2><p className="muted">Add each contractor and site once, then connect them with the right rate.</p></div><div className="setup-grid"><SetupCard title="Sites" count={data.sites.length}><SiteSetup onReload={onReload} onAnnounce={onAnnounce} /></SetupCard><ContractorsPanel onNotice={onAnnounce} onChanged={onReload} /><AssignmentManager contractors={data.contractors} sites={data.sites} weekStart={data.weekStart} weekLocked={weekLocked} onWeekRefresh={onReload} /></div></section>;
}
function SetupCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <article className="setup-card"><div className="setup-title"><h3>{title}</h3><span>{count}</span></div><div className="compact-list">{children}</div></article>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty"><span>◷</span><h3>{title}</h3><p>{body}</p></div>; }

const NZBN_DIGITS = /^\d{13}$/;

const ONBOARDING_COPY: Record<OnboardingStep, { kicker: string; title: string; body: string; action: string }> = {
  business: {
    kicker: "Business",
    title: "Add your business",
    body: "Start with the business that owns these sites and contractor payments.",
    action: "Save business",
  },
  site: {
    kicker: "Site",
    title: "Add a cleaning site",
    body: "Add the first site with the Sites card in Team & sites. That form is already on this page.",
    action: "Add a site",
  },
  contractor: {
    kicker: "Contractor",
    title: "Add a contractor",
    body: "Add a contractor with the Contractors card in Team & sites.",
    action: "Add a contractor",
  },
  assignment: {
    kicker: "Assignment",
    title: "Assign a contractor to a site",
    body: "Connect a contractor to a site in Assignments, under Team & sites.",
    action: "Assign a contractor",
  },
  schedule: {
    kicker: "Schedule",
    title: "Add a repeating schedule, or finish",
    body: "A repeating schedule is optional. Use Add repeating schedule on the week panel when the same days repeat. Finish setup whenever you are ready to record shifts.",
    action: "Finish setup",
  },
};

function guideErrorMessage(code: string) {
  if (code === "invalid_request") return "Check the business name, contact email, and optional details, then try again.";
  if (code === "business_required") return "Create the business before finishing setup.";
  return "That could not be saved. Please try again.";
}

function formText(fields: FormData, name: string): string {
  const value = fields.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function OwnerOnboarding({ step, onReload, onAnnounce }: Readonly<{ step: OnboardingStep; onReload: () => Promise<void>; onAnnounce: (message: string) => void }>) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sawStep = useRef(step);
  const copy = ONBOARDING_COPY[step];

  useEffect(() => {
    if (sawStep.current === step) return;
    sawStep.current = step;
    setError("");
    headingRef.current?.focus();
  }, [step]);

  async function saveGuide(action: () => Promise<void>, success: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
      await onReload();
      onAnnounce(success);
    } catch (error_) {
      const code = error_ instanceof Error ? error_.message : "";
      if (onboardingAdvancesOnError(code)) {
        await onReload();
        return;
      }
      setError(guideErrorMessage(code));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const name = formText(fields, "name");
    const contactEmail = formText(fields, "contactEmail");
    const nzbn = formText(fields, "nzbn");
    const address = formText(fields, "address");
    const contactPhone = formText(fields, "contactPhone");
    if (!name || !contactEmail) {
      setError("Enter a business name and contact email.");
      return;
    }
    if (nzbn !== "" && !NZBN_DIGITS.test(nzbn)) {
      setError("NZBN must be 13 digits, or left blank.");
      return;
    }
    await saveGuide(() => send("/api/business", {
      name,
      nzbn,
      address,
      contactEmail,
      contactPhone,
      timezone: "Pacific/Auckland",
      currency: "NZD",
      weekStart: "monday",
    }), "Business saved.");
  }

  function finishSetup() {
    void saveGuide(() => send("/api/business/onboarding/complete"), "Setup finished.");
  }

  return <section className="panel onboarding-guide" data-feature="owner-onboarding" aria-labelledby="onboarding-title">
    <div className="panel-title">
      <div>
        <p className="eyebrow">Getting started · {copy.kicker}</p>
        <h2 id="onboarding-title" ref={headingRef} tabIndex={-1}>{copy.title}</h2>
      </div>
    </div>
    <div className="onboarding-body">
      <p>{copy.body}</p>
      {error ? <p className="alert" id="onboarding-error" role="alert">{error}</p> : null}
      {step === "business" ? <form className="form-stack" onSubmit={(event) => void saveBusiness(event)} aria-describedby={error ? "onboarding-error" : undefined}>
        <label>Business name <small>Required</small>
          <input name="name" required maxLength={100} autoComplete="organization" disabled={busy} />
        </label>
        <label>Contact email <small>Required</small>
          <input name="contactEmail" type="email" required maxLength={254} autoComplete="email" disabled={busy} />
        </label>
        <label>NZBN <small>Optional. Leave blank or enter 13 digits.</small>
          <input name="nzbn" inputMode="numeric" maxLength={13} pattern="[0-9]{13}" title="Enter 13 digits or leave blank" autoComplete="off" disabled={busy} />
        </label>
        <label>Address <small>Optional</small>
          <input name="address" maxLength={240} autoComplete="street-address" disabled={busy} />
        </label>
        <label>Phone <small>Optional</small>
          <input name="contactPhone" type="tel" maxLength={40} autoComplete="tel" disabled={busy} />
        </label>
        <dl className="onboarding-fixed">
          <div><dt>Timezone</dt><dd>Pacific/Auckland</dd></div>
          <div><dt>Currency</dt><dd>NZD</dd></div>
          <div><dt>Week starts</dt><dd>Monday</dd></div>
        </dl>
        <div className="form-actions">
          <button className="button" type="submit" disabled={busy} aria-busy={busy}>{copy.action}</button>
        </div>
      </form> : null}
      {step === "site" || step === "contractor" || step === "assignment" ? <div className="form-actions">
        <a className="button onboarding-link" href="#team">{copy.action}</a>
      </div> : null}
      {step === "schedule" ? <div className="form-actions">
        <button type="button" className="button" onClick={finishSetup} disabled={busy} aria-busy={busy}>{copy.action}</button>
      </div> : null}
    </div>
  </section>;
}
