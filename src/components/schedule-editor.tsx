"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { assignmentMutationMessage } from "@/lib/assignment-manage";
import {
  initialScheduleDraft,
  SCHEDULE_WEEKDAY_OPTIONS,
  scheduleDraftError,
  scheduleEditorMode,
  schedulePutPayload,
  toggleScheduleWeekday,
  type ScheduleEditorDraft,
} from "@/lib/schedule-editor";

export type ScheduleEditorTarget = {
  id: string;
  contractorName: string;
  siteName: string;
  schedule: { id: string; weekdays: number[]; paidMinutes: number; effectiveFrom: string } | null;
};

export function ScheduleEditor({
  assignment,
  weekStart,
  weekLocked,
  onClose,
  onSave,
}: {
  assignment: ScheduleEditorTarget | null;
  weekStart: string;
  weekLocked: boolean;
  onClose: () => void;
  onSave: (body: ReturnType<typeof schedulePutPayload>["body"]) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<ScheduleEditorDraft>(() => initialScheduleDraft(assignment?.schedule ?? null));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const open = assignment != null;

  useEffect(() => {
    if (assignment) {
      setDraft(initialScheduleDraft(assignment.schedule));
      setError("");
      setBusy(false);
    }
  }, [assignment]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);

  if (!assignment) {
    return <dialog ref={dialogRef} className="modal schedule-editor-dialog" aria-labelledby="schedule-editor-title" aria-describedby="schedule-editor-copy" />;
  }

  const target = assignment;
  const mode = scheduleEditorMode(Boolean(target.schedule));
  const title = mode === "create" ? "Add repeating schedule" : "Edit repeating schedule";

  function close() {
    if (busy) return;
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = scheduleDraftError(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const payload = schedulePutPayload({
        draft,
        weekStart,
        weekLocked,
        hasCurrentSchedule: Boolean(target.schedule),
      });
      await onSave(payload.body);
      onClose();
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "";
      setError(raw.includes(" ") ? raw : assignmentMutationMessage(raw));
    } finally {
      setBusy(false);
    }
  }

  return <dialog
    ref={dialogRef}
    className="modal schedule-editor-dialog"
    aria-labelledby="schedule-editor-title"
    aria-describedby="schedule-editor-copy"
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) close(); }}
  >
    <form className="schedule-editor-form" onSubmit={submit}>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2 id="schedule-editor-title">{title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close schedule editor" onClick={close} disabled={busy}>×</button>
      </div>
      <p id="schedule-editor-copy">Usual days and hours for {assignment.contractorName} at {assignment.siteName}. The timesheet still records what actually happened.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <fieldset className="weekday-toggle">
        <legend>Weekdays</legend>
        <div className="weekday-toggle-row">
          {SCHEDULE_WEEKDAY_OPTIONS.map((day) => {
            const checked = draft.weekdays.includes(day.value);
            return <label key={day.value} className={checked ? "is-active" : ""}>
              <input
                type="checkbox"
                name={day.name}
                value={day.value}
                checked={checked}
                disabled={busy}
                onChange={() => setDraft({ ...draft, weekdays: toggleScheduleWeekday(draft.weekdays, day.value) })}
              />
              {day.label}
            </label>;
          })}
        </div>
      </fieldset>
      <fieldset className="duration-pair">
        <legend>Paid hours each scheduled day</legend>
        <p className="muted">Hours after unpaid breaks</p>
        <div className="duration-pair-row">
          <label>Hours
            <input type="number" inputMode="numeric" name="paidHours" min={0} max={23} step={1} required value={draft.paidHours} disabled={busy} onChange={(event) => setDraft({ ...draft, paidHours: Number(event.target.value) })} />
          </label>
          <label>Minutes
            <input type="number" inputMode="numeric" name="paidMinutes" min={0} max={59} step={1} required value={draft.paidMinutePart} disabled={busy} onChange={(event) => setDraft({ ...draft, paidMinutePart: Number(event.target.value) })} />
          </label>
        </div>
      </fieldset>
      <p className="muted">{mode === "create" ? "Starts from this week’s Monday." : weekLocked ? "Approved weeks stay as recorded. This change starts next Monday." : "Updates the schedule going forward from this week’s Monday."}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={close} disabled={busy}>Cancel</button>
        <button className="button" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : "Save schedule"}</button>
      </div>
    </form>
  </dialog>;
}
