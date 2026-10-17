"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { ShiftTableNote } from "@/components/shift-note";
import { ScheduleEditor, type ScheduleEditorTarget } from "@/components/schedule-editor";
import { assignmentMutationMessage } from "@/lib/assignment-manage";
import { paidMinutePartOptions } from "@/lib/shift-entry";
import { visibleShiftNote } from "@/lib/shift-note";
import { weekApprovalErrorMessage } from "@/lib/week-approval";
import type { ShiftDeleteTarget } from "@/lib/shift-delete";
import {
  buildWeekGridRows,
  entryForCell,
  exceptionRequest,
  hoursOverrideError,
  hoursOverridePaidMinutes,
  presentWeekGridCell,
  rowScheduleCaption,
  weekGridColumns,
  type WeekGridAssignment,
  type WeekGridEntry,
  type WeekGridRow,
} from "@/lib/week-grid";

type NamedPerson = { id: string; name: string };

const WEEKDAY_HEADERS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function mobileActionDate(isoDate: string) {
  return new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

type ChangeHoursTarget = {
  entry: WeekGridEntry;
  contractorName: string;
  siteName: string;
};

export function WeekGrid({
  weekStart,
  assignments,
  contractors,
  sites,
  entries,
  locked,
  onEdit,
  onDelete,
  onException,
}: {
  weekStart: string;
  assignments: WeekGridAssignment[];
  contractors: NamedPerson[];
  sites: NamedPerson[];
  entries: WeekGridEntry[];
  locked: boolean;
  onEdit: (entry: WeekGridEntry) => void;
  onDelete: (target: ShiftDeleteTarget) => void;
  onException: (url: string, body: unknown) => Promise<void>;
}) {
  const rows = buildWeekGridRows({ assignments, contractors, sites, entries });
  const columns = weekGridColumns(weekStart);
  const mobileGridId = useId();
  const [changeHours, setChangeHours] = useState<ChangeHoursTarget | null>(null);

  return <>
    <div className="week-grid-wrap">
      <table className="week-grid" role="grid" aria-label="Weekly timesheet">
        <thead>
          <tr>
            <th scope="col">Contractor / site</th>
            {columns.map((column, index) => (
              <th scope="col" key={column.iso}>
                <span className="week-grid-day">{WEEKDAY_HEADERS[index]}</span>
                <span className="week-grid-date">{column.iso.slice(8)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <WeekGridRowView
              key={`${row.contractorId}:${row.siteId}`}
              row={row}
              columns={columns}
              entries={entries}
              locked={locked}
              onEdit={onEdit}
              onDelete={onDelete}
              onException={onException}
              onChangeHours={setChangeHours}
            />
          ))}
        </tbody>
      </table>
    </div>
    <div className="week-grid-mobile" aria-label="Weekly timesheet">
      {rows.map((row) => {
        const headingId = `${mobileGridId}-${row.contractorId}-${row.siteId}`;
        return (
          <article className="week-grid-card" key={`${row.contractorId}:${row.siteId}`} aria-labelledby={headingId}>
            <header id={headingId}>
              <strong>{row.contractorName}</strong>
              <span>{row.siteName}{rowScheduleCaption(row.schedule) ? ` · ${rowScheduleCaption(row.schedule)}` : ""}</span>
            </header>
            <div className="week-grid-card-days">
              {columns.map((column, index) => {
                const entry = entryForCell(entries, row.contractorId, row.siteId, column.iso);
                const cell = presentWeekGridCell(entry);
                const note = entry ? visibleShiftNote(entry.notes) : null;
                const noteId = entry ? `mobile-shift-note-${entry.id}` : undefined;
                return <div className={`week-grid-mobile-day ${cell.className}`} key={column.iso} aria-describedby={note ? noteId : undefined}>
                  <div className="week-grid-mobile-date">
                    <span>{WEEKDAY_HEADERS[index]}</span>
                    <strong>{column.iso.slice(8)}</strong>
                  </div>
                  <div className="week-grid-mobile-entry">
                    <strong>{cell.kind === "empty" ? "No shift" : cell.kind === "absent" ? "Not worked" : cell.label}</strong>
                    {entry ? <ShiftTableNote notes={entry.notes} noteId={noteId!} /> : null}
                  </div>
                  {entry && cell.actions.length ? <select
                    className="week-grid-action-menu"
                    aria-label={`Actions for ${row.contractorName} at ${row.siteName} on ${WEEKDAY_HEADERS[index]} ${mobileActionDate(column.iso)}`}
                    value=""
                    disabled={locked}
                    onChange={(event) => {
                      const action = event.target.value;
                      if (action === "worked_as_scheduled") {
                        const request = exceptionRequest(entry.id, { kind: "worked_as_scheduled" });
                        void onException(request.url, request.body).catch(() => undefined);
                      } else if (action === "absent") {
                        const request = exceptionRequest(entry.id, { kind: "absent" });
                        void onException(request.url, request.body).catch(() => undefined);
                      } else if (action === "change_hours") {
                        setChangeHours({ entry, contractorName: row.contractorName, siteName: row.siteName });
                      } else if (action === "edit") {
                        onEdit(entry);
                      } else if (action === "delete") {
                        onDelete({ id: entry.id, contractorName: entry.contractorName, siteName: entry.siteName, workDate: entry.workDate });
                      }
                    }}
                  >
                    <option value="">Actions</option>
                    {cell.actions.includes("worked_as_scheduled") ? <option value="worked_as_scheduled">Worked as scheduled</option> : null}
                    {cell.actions.includes("absent") ? <option value="absent">Didn&apos;t work</option> : null}
                    {cell.actions.includes("change_hours") ? <option value="change_hours">Change hours</option> : null}
                    {cell.actions.includes("edit") ? <option value="edit">Edit shift</option> : null}
                    {cell.actions.includes("delete") ? <option value="delete">Delete shift</option> : null}
                  </select> : null}
                </div>;
              })}
            </div>
          </article>
        );
      })}
    </div>
    <ChangeHoursDialog
      target={changeHours}
      locked={locked}
      onClose={() => setChangeHours(null)}
      onException={onException}
    />
  </>;
}

function WeekGridRowView({
  row,
  columns,
  entries,
  locked,
  onEdit,
  onDelete,
  onException,
  onChangeHours,
}: {
  row: WeekGridRow;
  columns: ReturnType<typeof weekGridColumns>;
  entries: WeekGridEntry[];
  locked: boolean;
  onEdit: (entry: WeekGridEntry) => void;
  onDelete: (target: ShiftDeleteTarget) => void;
  onException: (url: string, body: unknown) => Promise<void>;
  onChangeHours: (target: ChangeHoursTarget) => void;
}) {
  const caption = rowScheduleCaption(row.schedule);
  return <tr>
    <th scope="row">
      <strong>{row.contractorName}</strong>
      <small>{row.siteName}{caption ? ` · ${caption}` : ""}</small>
    </th>
    {columns.map((column) => {
      const entry = entryForCell(entries, row.contractorId, row.siteId, column.iso);
      const cell = presentWeekGridCell(entry);
      const note = entry ? visibleShiftNote(entry.notes) : null;
      const noteId = entry ? `shift-note-${entry.id}` : undefined;
      return <td
        key={column.iso}
        className={cell.className}
        aria-describedby={note ? noteId : undefined}
      >
        {cell.kind === "empty" ? null : <span className="week-grid-cell-label">{cell.kind === "absent" ? "Not worked" : cell.label}</span>}
        {entry ? <ShiftTableNote notes={entry.notes} noteId={noteId!} /> : null}
        {cell.actions.length ? <div className="week-grid-cell-actions">
          {cell.actions.includes("worked_as_scheduled") && entry ? (
            <button type="button" className="button tiny secondary" disabled={locked} onClick={() => {
              if (locked) return;
              const request = exceptionRequest(entry.id, { kind: "worked_as_scheduled" });
              void onException(request.url, request.body).catch(() => undefined);
            }}>Worked as scheduled</button>
          ) : null}
          {cell.actions.includes("absent") && entry ? (
            <button
              type="button"
              className="button tiny secondary"
              disabled={locked}
              aria-label="Didn't work, this occurrence only"
              onClick={() => {
                if (locked) return;
                const request = exceptionRequest(entry.id, { kind: "absent" });
                void onException(request.url, request.body).catch(() => undefined);
              }}
            >Didn't work</button>
          ) : null}
          {cell.actions.includes("change_hours") && entry ? (
            <button type="button" className="button tiny" disabled={locked} onClick={() => {
              if (locked) return;
              onChangeHours({ entry, contractorName: row.contractorName, siteName: row.siteName });
            }}>Change hours</button>
          ) : null}
          {cell.actions.includes("edit") && entry ? (
            <button
              type="button"
              className="button tiny"
              aria-label={locked ? `Edit ${entry.contractorName} shift (week locked)` : `Edit ${entry.contractorName} shift`}
              disabled={locked}
              onClick={() => { if (locked) return; onEdit(entry); }}
            >Edit</button>
          ) : null}
          {cell.actions.includes("delete") && entry ? (
            <button
              type="button"
              className="icon-button"
              aria-label={locked ? `Delete ${entry.contractorName} shift (week locked)` : `Delete ${entry.contractorName} shift`}
              disabled={locked}
              onClick={() => {
                if (locked) return;
                onDelete({ id: entry.id, contractorName: entry.contractorName, siteName: entry.siteName, workDate: entry.workDate });
              }}
            >×</button>
          ) : null}
        </div> : null}
      </td>;
    })}
  </tr>;
}

function ChangeHoursDialog({
  target,
  locked,
  onClose,
  onException,
}: {
  target: ChangeHoursTarget | null;
  locked: boolean;
  onClose: () => void;
  onException: (url: string, body: unknown) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(30);
  const [scope, setScope] = useState<"this_day" | "going_forward">("this_day");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!target) return;
    const paid = target.entry.paidMinutes > 0 ? target.entry.paidMinutes : 90;
    setHours(Math.floor(paid / 60));
    setMinutes(paid % 60);
    setScope("this_day");
    setError("");
    setBusy(false);
  }, [target]);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || locked) return;
    const problem = hoursOverrideError(hours, minutes);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError("");
    try {
      const request = exceptionRequest(target.entry.id, {
        kind: "hours_override",
        paidMinutes: hoursOverridePaidMinutes(hours, minutes),
        scope,
      });
      await onException(request.url, request.body);
      onClose();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(
        code === "week_locked" || code === "stale_week" || code === "week_not_approved"
          ? weekApprovalErrorMessage(code)
          : code === "schedule_exists" || code === "no_schedule" || code === "invalid_week"
            ? assignmentMutationMessage(code)
            : code.includes(" ")
              ? code
              : "That could not be saved. Check for a duplicate or missing assignment.",
      );
    } finally {
      setBusy(false);
    }
  }

  return <dialog
    ref={dialogRef}
    className="modal change-hours-dialog"
    aria-labelledby="change-hours-title"
    aria-describedby="change-hours-copy"
    onCancel={(event) => { if (busy) event.preventDefault(); else onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    {target ? <form onSubmit={submit}>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Timesheet exception</p>
          <h2 id="change-hours-title">Change hours</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close change hours" onClick={onClose} disabled={busy}>×</button>
      </div>
      <p id="change-hours-copy">Change paid hours for {target.contractorName} at {target.siteName}. Choose this day only or schedule going forward.</p>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <fieldset className="duration-pair">
        <legend>Paid hours</legend>
        <div className="duration-pair-row">
          <label>Hours
            <input type="number" inputMode="numeric" min={0} max={23} step={1} required value={hours} disabled={busy} onChange={(event) => setHours(Number(event.target.value))} />
          </label>
          <label>Minutes
            <select inputMode="numeric" required value={minutes} disabled={busy} onChange={(event) => setMinutes(Number(event.target.value))}>
              {paidMinutePartOptions(minutes).map((value) => <option value={value} key={value}>{value}</option>)}
            </select>
          </label>
        </div>
      </fieldset>
      <fieldset className="scope-toggle">
        <legend>Apply to</legend>
        <label className={scope === "this_day" ? "is-active" : ""}>
          <input type="radio" name="hours-scope" value="this_day" checked={scope === "this_day"} disabled={busy} onChange={() => setScope("this_day")} />
          this day only
        </label>
        <label className={scope === "going_forward" ? "is-active" : ""}>
          <input type="radio" name="hours-scope" value="going_forward" checked={scope === "going_forward"} disabled={busy} onChange={() => setScope("going_forward")} />
          schedule going forward
        </label>
      </fieldset>
      <p className="muted">Absent stays this occurrence only and is not offered here.</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button" disabled={busy || locked} aria-busy={busy}>Save hours</button>
      </div>
    </form> : null}
  </dialog>;
}

export function AddRepeatingSchedule({
  assignments,
  contractors,
  sites,
  weekStart,
  locked,
  onSave,
}: {
  assignments: WeekGridAssignment[];
  contractors: NamedPerson[];
  sites: NamedPerson[];
  weekStart: string;
  locked: boolean;
  onSave: (assignmentId: string, body: unknown) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? "");
  const [editing, setEditing] = useState<ScheduleEditorTarget | null>(null);
  const named = assignments.map((assignment) => ({
    ...assignment,
    contractorName: contractors.find((row) => row.id === assignment.contractorId)?.name ?? "",
    siteName: sites.find((row) => row.id === assignment.siteId)?.name ?? "",
  }));

  useEffect(() => {
    if (!assignments.some((row) => row.id === assignmentId)) setAssignmentId(assignments[0]?.id ?? "");
  }, [assignments, assignmentId]);

  function openEditor() {
    const selected = named.find((row) => row.id === assignmentId);
    if (!selected) return;
    setPicking(false);
    setEditing({
      id: selected.id,
      contractorName: selected.contractorName,
      siteName: selected.siteName,
      schedule: selected.schedule,
    });
  }

  return <>
    <button type="button" className="button small secondary" disabled={locked || named.length === 0} onClick={() => { if (locked) return; setPicking(true); }}>Add repeating schedule</button>
    <AddSchedulePicker
      open={picking}
      assignments={named}
      assignmentId={assignmentId}
      onAssignmentId={setAssignmentId}
      onCancel={() => setPicking(false)}
      onContinue={openEditor}
    />
    <ScheduleEditor
      assignment={editing}
      weekStart={weekStart}
      weekLocked={locked}
      onClose={() => setEditing(null)}
      onSave={async (body) => {
        if (!editing) return;
        await onSave(editing.id, body);
      }}
    />
  </>;
}

function AddSchedulePicker({
  open,
  assignments,
  assignmentId,
  onAssignmentId,
  onCancel,
  onContinue,
}: {
  open: boolean;
  assignments: Array<{ id: string; contractorName: string; siteName: string }>;
  assignmentId: string;
  onAssignmentId: (id: string) => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);
  return <dialog
    ref={dialogRef}
    className="modal add-schedule-dialog"
    aria-labelledby="add-schedule-title"
    aria-describedby="add-schedule-copy"
    onCancel={onCancel}
    onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}
  >
    {open ? <>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Schedule</p>
          <h2 id="add-schedule-title">Add repeating schedule</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close add repeating schedule" onClick={onCancel}>×</button>
      </div>
      <p id="add-schedule-copy">Choose the contractor and site assignment this schedule belongs to.</p>
      <label>Assignment
        <select name="assignmentId" value={assignmentId} onChange={(event) => onAssignmentId(event.target.value)}>
          {assignments.map((row) => (
            <option key={row.id} value={row.id}>{row.contractorName} — {row.siteName}</option>
          ))}
        </select>
      </label>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="button" onClick={onContinue} disabled={!assignmentId}>Continue</button>
      </div>
    </> : null}
  </dialog>;
}
