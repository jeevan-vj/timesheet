"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { createShiftDeleteFlow, idleShiftDelete, shiftDeletePrompt, type ShiftDeleteSession } from "@/lib/shift-delete";

type Site = { id: string; name: string; address: string };
type Contractor = { id: string; name: string; email: string; phone: string; defaultRateCents: number; currency: string };
type Assignment = { id: string; contractorId: string; siteId: string; rateCents: number | null };
type Entry = { id: string; contractorId: string; contractorName: string; siteId: string; siteName: string; workDate: string; startMinutes: number; endMinutes: number; breakMinutes: number; paidMinutes: number; rateCents: number; notes: string };
type Summary = { contractorId: string; contractorName: string; paidMinutes: number; payCents: number };
type DashboardData = { weekStart: string; weekEnd: string; sites: Site[]; contractors: Contractor[]; assignments: Assignment[]; entries: Entry[]; summary: Summary[] };

function mondayFor(date = new Date()): string {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7; value.setUTCDate(value.getUTCDate() - day + 1); return value.toISOString().slice(0, 10);
}
function shiftWeek(week: string, days: number): string { const value = new Date(`${week}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function money(cents: number) { return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(cents / 100); }
function duration(minutes: number) { return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`; }
function clock(minutes: number) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function toMinutes(value: string) { const [h, m] = value.split(":").map(Number); return h * 60 + m; }
function readableDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short" }).format(new Date(`${value}T00:00:00Z`)); }
function fullDate(value: string) { return new Intl.DateTimeFormat("en-NZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00Z`)); }

async function send(url: string, body?: unknown, method = "POST") {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error ?? "request_failed"); }
}

export function Dashboard() {
  const [week, setWeek] = useState(() => mondayFor()); const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true); const [message, setMessage] = useState("");
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true); setMessage("");
    const response = await fetch(`/api/dashboard?week=${week}`, { cache: "no-store" });
    if (response.status === 401) { window.location.assign("/sign-in"); return; }
    if (generation !== loadGeneration.current) return;
    if (!response.ok) { setMessage("Could not load this week. Please try again."); setLoading(false); return; }
    setData(await response.json() as DashboardData); setLoading(false);
  }, [week]);
  useEffect(() => { void load(); }, [load]);
  const totalMinutes = data?.summary.reduce((sum, row) => sum + row.paidMinutes, 0) ?? 0;
  const totalPay = data?.summary.reduce((sum, row) => sum + row.payCents, 0) ?? 0;

  async function mutate(action: () => Promise<void>, success: string) {
    try { setMessage(""); await action(); setMessage(success); await load(); } catch (error) { setMessage(error instanceof Error && error.message === "invalid_shift" ? "Finish time and break must leave a positive paid shift." : "That could not be saved. Check for a duplicate or missing assignment."); }
  }
  const mutateRef = useRef(mutate);
  mutateRef.current = mutate;
  const [deleteSession, setDeleteSession] = useState(idleShiftDelete);
  const deleteFlow = useRef(createShiftDeleteFlow(async (request) => {
    await mutateRef.current(() => send(request.url, undefined, request.method), "Shift removed.");
  }, setDeleteSession)).current;

  return <main className="app-shell">
    <header className="app-header"><a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a><nav><a href="#team">Team & sites</a><button className="link-button" onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}>Sign out</button></nav></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Weekly workspace</p><h1>Hours & contractor pay</h1><p className="muted">Gross contractor payments before tax, GST, expenses, or adjustments.</p></div><WeekPicker week={week} onChange={setWeek} /></section>
    {message ? <p className="notice" role="status">{message}</p> : null}
    {loading || !data ? <section className="loading-card">Loading your week…</section> : <>
      <section className="stats"><article><span>Paid hours</span><strong>{duration(totalMinutes)}</strong><small>{data.entries.length} daily {data.entries.length === 1 ? "entry" : "entries"}</small></article><article><span>Contractor pay</span><strong>{money(totalPay)}</strong><small>{data.summary.length} {data.summary.length === 1 ? "contractor" : "contractors"}</small></article><article><span>Active sites</span><strong>{data.sites.length}</strong><small>{data.assignments.length} team assignments</small></article></section>
      <section className="main-grid">
        <section className="panel"><div className="panel-title"><div><p className="eyebrow">Monday – Sunday</p><h2>{readableDate(data.weekStart)} – {readableDate(data.weekEnd)}</h2></div><EntryDialog data={data} onSave={(body) => mutate(() => send("/api/time-entries", body), "Shift added.")} /></div>
          {data.entries.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Contractor</th><th>Site</th><th>Shift</th><th>Paid</th><th>Pay</th><th></th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.id}><td>{readableDate(entry.workDate)}</td><td><strong>{entry.contractorName}</strong></td><td>{entry.siteName}</td><td>{clock(entry.startMinutes)}–{clock(entry.endMinutes)}<small>{entry.breakMinutes ? `${entry.breakMinutes}m break` : "No break"}</small></td><td>{duration(entry.paidMinutes)}</td><td><strong>{money(Math.round(entry.paidMinutes * entry.rateCents / 60))}</strong><small>{money(entry.rateCents)}/hr</small></td><td><button className="icon-button" aria-label={`Delete ${entry.contractorName} shift`} onClick={() => deleteFlow.request({ id: entry.id, contractorName: entry.contractorName, siteName: entry.siteName, workDate: entry.workDate })}>×</button></td></tr>)}</tbody></table></div> : <EmptyState title="No shifts this week" body="Add the first daily shift once a contractor is assigned to a site." />}
        </section>
        <aside className="panel summary-panel"><p className="eyebrow">Payment summary</p><h2>What to pay</h2>{data.summary.length ? <>{data.summary.map((row) => <div className="summary-row" key={row.contractorId}><div><strong>{row.contractorName}</strong><small>{duration(row.paidMinutes)}</small></div><b>{money(row.payCents)}</b></div>)}<div className="summary-total"><span>Total</span><strong>{money(totalPay)}</strong></div></> : <p className="muted roomy">Payment totals appear as shifts are added.</p>}</aside>
      </section>
      <SetupPanel data={data} mutate={mutate} />
    </>}
    <DeleteShiftDialog session={deleteSession} onCancel={() => deleteFlow.cancel()} onConfirm={() => void deleteFlow.confirm()} />
  </main>;
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
  }, [target]);
  return <dialog ref={dialogRef} className="modal delete-shift-dialog" aria-labelledby="delete-shift-title" aria-describedby="delete-shift-copy" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
    {prompt ? <><div className="modal-title"><div><p className="eyebrow">Remove recorded hours</p><h2 id="delete-shift-title">{prompt.title}</h2></div><button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button></div><p id="delete-shift-copy">{prompt.description}</p><div className="form-actions"><button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button><button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button></div></> : null}
  </dialog>;
}

function WeekPicker({ week, onChange }: { week: string; onChange: (value: string) => void }) {
  return <div className="week-picker"><button onClick={() => onChange(shiftWeek(week, -7))} aria-label="Previous week">←</button><label>Week of<input type="date" value={week} onChange={(e) => onChange(mondayFor(new Date(`${e.target.value}T12:00:00`)))} /></label><button onClick={() => onChange(shiftWeek(week, 7))} aria-label="Next week">→</button></div>;
}

function EntryDialog({ data, onSave }: { data: DashboardData; onSave: (body: unknown) => Promise<void> }) {
  const [open, setOpen] = useState(false); const [contractorId, setContractor] = useState("");
  const selectedContractorId = contractorId || data.assignments[0]?.contractorId || data.contractors[0]?.id || "";
  const assignedSites = data.assignments.filter((a) => a.contractorId === selectedContractorId).map((a) => data.sites.find((s) => s.id === a.siteId)).filter((s): s is Site => Boolean(s));
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); await onSave({ contractorId: selectedContractorId, siteId: String(form.get("siteId")), workDate: String(form.get("workDate")), startMinutes: toMinutes(String(form.get("start"))), endMinutes: toMinutes(String(form.get("end"))), breakMinutes: Number(form.get("breakMinutes")), notes: String(form.get("notes")) }); setOpen(false); }
  return <div className="dialog-wrap"><button className="button small" disabled={!data.assignments.length} onClick={() => setOpen(true)}>+ Add shift</button>{open ? <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.currentTarget === e.target) setOpen(false); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="shift-title"><div className="modal-title"><div><p className="eyebrow">Daily entry</p><h2 id="shift-title">Add a completed shift</h2></div><button className="icon-button" aria-label="Close shift form" onClick={() => setOpen(false)}>×</button></div><form className="form-grid" onSubmit={submit}><label>Contractor<select value={selectedContractorId} onChange={(e) => setContractor(e.target.value)} required>{data.contractors.map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}</select></label><label>Site<select name="siteId" required>{assignedSites.map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label><label>Date<input name="workDate" type="date" min={data.weekStart} max={data.weekEnd} defaultValue={data.weekStart} required /></label><label>Unpaid break<select name="breakMinutes" defaultValue="30"><option value="0">No break</option><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">1 hour</option></select></label><label>Start<input name="start" type="time" defaultValue="08:00" required /></label><label>Finish<input name="end" type="time" defaultValue="16:30" required /></label><label className="full">Notes (optional)<textarea name="notes" maxLength={500} placeholder="Keys returned, extra area cleaned…" /></label><div className="full form-actions"><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button><button className="button">Save shift</button></div></form></section></div> : null}</div>;
}

function SetupPanel({ data, mutate }: { data: DashboardData; mutate: (action: () => Promise<void>, success: string) => Promise<void> }) {
  return <section className="setup" id="team"><div><p className="eyebrow">Workspace setup</p><h2>Team & cleaning sites</h2><p className="muted">Add each contractor and site once, then connect them with the right rate.</p></div><div className="setup-grid"><SetupCard title="Sites" count={data.sites.length}>{data.sites.map((site) => <div className="compact-row" key={site.id}><strong>{site.name}</strong><small>{site.address || "No address"}</small></div>)}<SiteForm onSave={(body) => mutate(() => send("/api/sites", body), "Site added.")} /></SetupCard><SetupCard title="Contractors" count={data.contractors.length}>{data.contractors.map((contractor) => <div className="compact-row" key={contractor.id}><strong>{contractor.name}</strong><small>{money(contractor.defaultRateCents)}/hr</small></div>)}<ContractorForm onSave={(body) => mutate(() => send("/api/contractors", body), "Contractor added.")} /></SetupCard><SetupCard title="Assignments" count={data.assignments.length}>{data.assignments.map((assignment) => { const contractor = data.contractors.find((c) => c.id === assignment.contractorId); const site = data.sites.find((s) => s.id === assignment.siteId); return <div className="compact-row" key={assignment.id}><strong>{contractor?.name} → {site?.name}</strong><small>{assignment.rateCents ? `${money(assignment.rateCents)}/hr override` : "Default rate"}</small></div>; })}<AssignmentForm data={data} onSave={(body) => mutate(() => send("/api/assignments", body), "Assignment added.")} /></SetupCard></div></section>;
}
function SetupCard({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <article className="setup-card"><div className="setup-title"><h3>{title}</h3><span>{count}</span></div><div className="compact-list">{children}</div></article>; }
function SiteForm({ onSave }: { onSave: (body: unknown) => Promise<void> }) { async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await onSave({ name: f.get("name"), address: f.get("address") }); e.currentTarget.reset(); } return <details><summary>+ Add site</summary><form className="mini-form" onSubmit={submit}><input name="name" placeholder="Site name" required maxLength={100}/><input name="address" placeholder="Address (optional)" maxLength={240}/><button className="button small">Save site</button></form></details>; }
function ContractorForm({ onSave }: { onSave: (body: unknown) => Promise<void> }) { async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); await onSave({ name: f.get("name"), email: f.get("email"), phone: f.get("phone"), defaultRateCents: Math.round(Number(f.get("rate")) * 100) }); e.currentTarget.reset(); } return <details><summary>+ Add contractor</summary><form className="mini-form" onSubmit={submit}><input name="name" placeholder="Contractor name" required maxLength={100}/><input name="email" type="email" placeholder="Email (optional)"/><input name="phone" placeholder="Phone (optional)" maxLength={40}/><label>Default hourly rate (NZD)<input name="rate" type="number" min="15" max="250" step="0.01" defaultValue="30.00" required/></label><button className="button small">Save contractor</button></form></details>; }
function AssignmentForm({ data, onSave }: { data: DashboardData; onSave: (body: unknown) => Promise<void> }) { async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); const f = new FormData(e.currentTarget); const value = String(f.get("rate")); await onSave({ contractorId: f.get("contractorId"), siteId: f.get("siteId"), rateCents: value ? Math.round(Number(value) * 100) : null }); e.currentTarget.reset(); } return <details><summary>+ Assign to site</summary><form className="mini-form" onSubmit={submit}><select name="contractorId" required><option value="">Choose contractor</option>{data.contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select><select name="siteId" required><option value="">Choose site</option>{data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><label>Rate override (optional)<input name="rate" type="number" min="15" max="250" step="0.01" placeholder="Use default rate"/></label><button className="button small" disabled={!data.contractors.length || !data.sites.length}>Save assignment</button></form></details>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="empty"><span>◷</span><h3>{title}</h3><p>{body}</p></div>; }
