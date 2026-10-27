"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  ASSIGN_ANOTHER_SITE,
  breakMinuteOptions,
  contractorsForEdit,
  createShiftSaveGuard,
  draftDurationError,
  draftFromTimeEntry,
  draftPaidMinutes,
  draftSaveError,
  editPreviewRateCents,
  effectiveRateCents,
  formatNzd,
  formatPayPreview,
  isEditReclassification,
  initialShiftDraft,
  parseRateDollars,
  paidMinutePartOptions,
  selectContractor,
  selectSite,
  shiftEntryBlocker,
  shiftEntryPayload,
  shiftSaveErrorMessage,
  shiftUpdatePayload,
  sitesForContractor,
  shiftDateBounds,
  sitesForEdit,
  switchEntryMode,
  type RecordedTimeEntry,
  type ShiftEntryDraft,
} from "@/lib/shift-entry";

type Site = { id: string; name: string };
type Contractor = { id: string; name: string; defaultRateCents: number };
type Assignment = { contractorId: string; siteId: string; rateCents: number | null };

export type ShiftEntryData = {
  weekStart: string;
  weekEnd: string;
  sites: Site[];
  contractors: Contractor[];
  assignments: Assignment[];
};

function startingDraft(data: ShiftEntryData): ShiftEntryDraft {
  const contractorId = data.contractors[0]?.id ?? "";
  const assignedId = sitesForContractor(data.sites, data.assignments, contractorId).assigned[0]?.id ?? "";
  return initialShiftDraft({ weekStart: data.weekStart, contractorId, siteId: assignedId });
}

function breakLabel(minutes: number) {
  if (minutes === 0) return "No break";
  if (minutes === 60) return "1 hour";
  return `${minutes} minutes`;
}

export function ShiftEntrySheet({
  data,
  entry,
  onSave,
  onDismiss,
  locked = false,
}: {
  data: ShiftEntryData;
  entry?: RecordedTimeEntry;
  onSave: (body: unknown) => Promise<void>;
  onDismiss?: () => void;
  locked?: boolean;
}) {
  const editing = Boolean(entry);
  const blocker = editing ? null : shiftEntryBlocker(data);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const guard = useRef(createShiftSaveGuard()).current;
  const [open, setOpen] = useState(editing);
  const [draft, setDraft] = useState<ShiftEntryDraft>(() => entry ? draftFromTimeEntry(entry) : startingDraft(data));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const titleId = editing ? "edit-shift-title" : "shift-title";
  const modeName = editing ? "edit-entry-mode" : "entry-mode";

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);

  const grouped = useMemo(
    () => sitesForContractor(data.sites, data.assignments, draft.contractorId),
    [data.sites, data.assignments, draft.contractorId],
  );
  const contractorOptions = entry
    ? contractorsForEdit(data.contractors, { id: entry.contractorId, name: entry.contractorName })
    : data.contractors;
  const siteOptions = entry
    ? sitesForEdit(data.sites, data.assignments, draft.contractorId, {
      contractorId: entry.contractorId,
      siteId: entry.siteId,
      siteName: entry.siteName,
    })
    : grouped.assigned;
  const contractor = data.contractors.find((row) => row.id === draft.contractorId);
  const assigning = !editing && (draft.assigningSite || draft.siteId === ASSIGN_ANOTHER_SITE);
  const assignment = data.assignments.find((row) => row.contractorId === draft.contractorId && row.siteId === draft.siteId);
  const overrideRate = assigning ? parseRateDollars(draft.newSiteRate) : null;
  const rateCents = entry
    ? editPreviewRateCents({
      entry,
      draft,
      defaultRateCents: contractor?.defaultRateCents ?? null,
      assignmentRateCents: assignment ? assignment.rateCents : undefined,
    })
    : contractor && overrideRate !== "invalid"
      ? effectiveRateCents({
        defaultRateCents: contractor.defaultRateCents,
        assignmentRateCents: assigning ? null : assignment?.rateCents ?? null,
        overrideRateCents: typeof overrideRate === "number" ? overrideRate : null,
      })
      : null;
  const paidMinutes = draftPaidMinutes(draft);
  const durationError = draftDurationError(draft);
  const preview = rateCents && paidMinutes ? formatPayPreview(paidMinutes, rateCents) : null;
  const dateBounds = shiftDateBounds(editing, data.weekStart, data.weekEnd);

  function openSheet() {
    setDraft(startingDraft(data));
    setError("");
    setBusy(false);
    setOpen(true);
  }

  function closeSheet() {
    if (busy) return;
    setOpen(false);
    setError("");
    onDismiss?.();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = draftSaveError(draft, editing ? { allowAssignSite: false } : undefined);
    if (problem) { setError(problem); return; }
    await guard.run(async () => {
      setBusy(true);
      setError("");
      try {
        await onSave(editing ? shiftUpdatePayload(draft) : shiftEntryPayload(draft));
        setOpen(false);
        onDismiss?.();
      } catch (cause) {
        setError(editing ? shiftSaveErrorMessage(cause, "edit") : shiftSaveErrorMessage(cause));
      } finally {
        setBusy(false);
      }
    });
  }

  if (locked && !editing) {
    return <p className="muted week-locked-hint">This week is approved and locked. Reopen it to add a shift.</p>;
  }

  if (blocker) {
    return <div className="shift-setup-action"><p className="muted">{blocker.message}</p><a className="button small" href={blocker.href}>{blocker.label}</a></div>;
  }

  return <div className="dialog-wrap">
    {editing ? null : <button type="button" className="button small" onClick={openSheet}>+ Add shift</button>}
    <dialog
      ref={dialogRef}
      className="modal shift-sheet"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); closeSheet(); }}
      onClick={(event) => { if (event.target === event.currentTarget && !busy) closeSheet(); }}
    >
      <form className="shift-sheet-form" onSubmit={submit}>
        <div className="modal-title">
          <div>
            <p className="eyebrow">{editing ? "Correction" : "Daily entry"}</p>
            <h2 id={titleId}>{editing ? "Correct this shift" : "Add a completed shift"}</h2>
          </div>
          <button type="button" className="icon-button sheet-close" aria-label="Close shift form" onClick={closeSheet} disabled={busy}>×</button>
        </div>
        <div className="shift-sheet-body">
          {error ? <p className="alert" role="alert">{error}</p> : null}
          <label>Contractor
            <select value={draft.contractorId} autoFocus required onChange={(event) => {
              const contractorId = event.target.value;
              const assignedIds = sitesForContractor(data.sites, data.assignments, contractorId).assigned.map((site) => site.id);
              setDraft(selectContractor(draft, contractorId, assignedIds));
            }}>
              {contractorOptions.map((row) => <option value={row.id} key={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label>Site
            <select
              value={assigning ? ASSIGN_ANOTHER_SITE : draft.siteId}
              required
              onChange={(event) => setDraft(selectSite(draft, event.target.value))}
            >
              <option value="" disabled>Choose a site</option>
              {siteOptions.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}
              {!editing && grouped.unassigned.length ? <option value={ASSIGN_ANOTHER_SITE}>Assign another site</option> : null}
            </select>
          </label>
          {assigning ? <>
            <label>Site to assign
              <select value={draft.newSiteId} required onChange={(event) => setDraft({ ...draft, newSiteId: event.target.value })}>
                <option value="">Choose a site</option>
                {grouped.unassigned.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}
              </select>
            </label>
            <p className="muted rate-hint">Default rate {contractor ? `${formatNzd(contractor.defaultRateCents)}/hr` : ""}</p>
            <label>Rate for this site <small>Optional override</small>
              <input
                type="number"
                inputMode="decimal"
                min={15}
                max={250}
                step="0.01"
                placeholder="Use default rate"
                value={draft.newSiteRate}
                onChange={(event) => setDraft({ ...draft, newSiteRate: event.target.value })}
              />
            </label>
          </> : null}
          <label>Date
            <input type="date" min={dateBounds.min} max={dateBounds.max} required value={draft.workDate} onChange={(event) => setDraft({ ...draft, workDate: event.target.value })} />
          </label>
          <fieldset className="mode-toggle">
            <legend>Entry method</legend>
            <div role="radiogroup" aria-label="Entry method" className="mode-toggle-row">
              <label className={draft.mode === "paid_hours" ? "is-active" : ""}>
                <input type="radio" name={modeName} checked={draft.mode === "paid_hours"} onChange={() => setDraft(switchEntryMode(draft, "paid_hours"))} />
                Paid hours
              </label>
              <label className={draft.mode === "clock" ? "is-active" : ""}>
                <input type="radio" name={modeName} checked={draft.mode === "clock"} onChange={() => setDraft(switchEntryMode(draft, "clock"))} />
                Start &amp; finish
              </label>
            </div>
          </fieldset>
          {draft.mode === "paid_hours" ? (
            <fieldset className="duration-pair">
              <legend>Paid hours</legend>
              <p className="muted">Hours after unpaid breaks</p>
              <div className="duration-pair-row">
                <label>Hours
                  <input type="number" inputMode="numeric" min={0} max={23} step={1} required value={draft.paidHours} onChange={(event) => setDraft({ ...draft, paidHours: Number(event.target.value) })} />
                </label>
                <label>Minutes
                  <select inputMode="numeric" required value={draft.paidMinutePart} onChange={(event) => setDraft({ ...draft, paidMinutePart: Number(event.target.value) })}>
                    {paidMinutePartOptions(draft.paidMinutePart).map((minutes) => <option value={minutes} key={minutes}>{minutes}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
          ) : (
            <div className="clock-fields">
              <label>Start
                <input type="time" required value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} />
              </label>
              <label>Finish
                <input type="time" required value={draft.end} onChange={(event) => setDraft({ ...draft, end: event.target.value })} />
              </label>
              <label className="full">Unpaid break
                <select value={draft.breakMinutes} onChange={(event) => setDraft({ ...draft, breakMinutes: Number(event.target.value) })}>
                  {breakMinuteOptions(draft.breakMinutes).map((minutes) => (
                    <option value={minutes} key={minutes}>{breakLabel(minutes)}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {durationError ? <p className="field-error" role="status">{durationError}</p> : null}
          <div className="pay-preview" aria-live="polite">
            <p className="eyebrow">Estimated gross pay</p>
            {preview ? <p className="pay-preview-sum">{preview}</p> : <p className="muted">Enter paid hours to see estimated pay.</p>}
            {editing && entry && isEditReclassification(entry, draft) && preview
              ? <p className="muted">Changing contractor or site snapshots the current site rate onto this shift.</p>
              : null}
          </div>
          <label className="notes-field">Notes <small>Optional</small>
            <textarea maxLength={500} placeholder="Keys returned, extra area cleaned…" value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </label>
        </div>
        <div className="shift-sheet-footer">
          <button type="button" className="button secondary" onClick={closeSheet} disabled={busy}>Cancel</button>
          <button className="button" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Save shift"}</button>
        </div>
      </form>
    </dialog>
  </div>;
}
