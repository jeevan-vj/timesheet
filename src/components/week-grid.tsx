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
  WEEK_GRID_LEGEND,
  buildWeekGridRows,
  cellAriaLabel,
  entryForCell,
  exceptionRequest,
  hoursOverrideError,
  hoursOverridePaidMinutes,
  pendingEntryIds,
  presentWeekGridCell,
  rowScheduleCaption,
  weekGridColumns,
  weekGridMenuLabel,
  type WeekGridAssignment,
  type WeekGridCell,
  type WeekGridEntry,
  type WeekGridIcon,
  type WeekGridMenuAction,
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
  onMarkWorked,
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
  onMarkWorked: (ids: string[]) => void;
}) {
  const rows = buildWeekGridRows({ assignments, contractors, sites, entries });
  const columns = weekGridColumns(weekStart);
  const mobileGridId = useId();
  const [changeHours, setChangeHours] = useState<ChangeHoursTarget | null>(null);
  const onAction = (action: WeekGridMenuAction, entry: WeekGridEntry) => {
    dispatchCellAction(action, entry, { onEdit, onDelete, onException, onChangeHours: setChangeHours });
  };

  return <>
    <WeekGridLegend />
    <div className="week-grid-wrap">
      <table className={locked ? "week-grid is-locked" : "week-grid"} role="grid" aria-label="Weekly timesheet">
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
              onMarkWorked={onMarkWorked}
              onAction={onAction}
            />
          ))}
        </tbody>
      </table>
    </div>
    <div className="week-grid-mobile" aria-label="Weekly timesheet">
      {rows.map((row) => {
        const headingId = `${mobileGridId}-${row.contractorId}-${row.siteId}`;
        const pendingIds = pendingEntryIds(entries, row.contractorId, row.siteId, columns.map((column) => column.iso));
        return (
          <article className="week-grid-card" key={`${row.contractorId}:${row.siteId}`} aria-labelledby={headingId}>
            <header id={headingId}>
              <strong>{row.contractorName}</strong>
              <span>{row.siteName}{rowScheduleCaption(row.schedule) ? ` · ${rowScheduleCaption(row.schedule)}` : ""}</span>
              <MarkAllWorked locked={locked} ids={pendingIds} contractorName={row.contractorName} siteName={row.siteName} onMarkWorked={onMarkWorked} />
            </header>
            <div className="week-grid-card-days">
              {columns.map((column, index) => (
                <MobileDay
                  key={column.iso}
                  row={row}
                  iso={column.iso}
                  weekday={WEEKDAY_HEADERS[index] ?? ""}
                  entry={entryForCell(entries, row.contractorId, row.siteId, column.iso)}
                  locked={locked}
                  onMarkWorked={onMarkWorked}
                  onAction={onAction}
                />
              ))}
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

function legendClass(kind: (typeof WEEK_GRID_LEGEND)[number]["kind"]) {
  if (kind === "hours_override") return "changed";
  if (kind === "scheduled") return "pending";
  return kind;
}

function WeekGridLegend() {
  return <ul className="week-grid-legend" aria-label="Timesheet states">
    {WEEK_GRID_LEGEND.map((item) => (
      <li key={item.kind}>
        <span className={`legend-swatch is-${legendClass(item.kind)}`} aria-hidden="true">
          <StatusIcon icon={item.icon} />
        </span>
        {item.label}
      </li>
    ))}
  </ul>;
}

function dispatchCellAction(
  action: WeekGridMenuAction,
  entry: WeekGridEntry,
  handlers: {
    onEdit: (entry: WeekGridEntry) => void;
    onDelete: (target: ShiftDeleteTarget) => void;
    onException: (url: string, body: unknown) => Promise<void>;
    onChangeHours: (target: ChangeHoursTarget) => void;
  },
) {
  if (action === "absent" || action === "reset") {
    const request = exceptionRequest(entry.id, { kind: action === "absent" ? "absent" : "worked_as_scheduled" });
    void handlers.onException(request.url, request.body).catch(() => undefined);
    return;
  }
  if (action === "change_hours") {
    handlers.onChangeHours({ entry, contractorName: entry.contractorName, siteName: entry.siteName });
    return;
  }
  if (action === "edit") {
    handlers.onEdit(entry);
    return;
  }
  handlers.onDelete({ id: entry.id, contractorName: entry.contractorName, siteName: entry.siteName, workDate: entry.workDate });
}

function MarkAllWorked({
  locked,
  ids,
  contractorName,
  siteName,
  onMarkWorked,
}: {
  locked: boolean;
  ids: string[];
  contractorName: string;
  siteName: string;
  onMarkWorked: (ids: string[]) => void;
}) {
  if (locked || ids.length === 0) return null;
  return <button
    type="button"
    className="button tiny secondary week-grid-mark-all"
    aria-label={`Mark all pending days worked for ${contractorName} at ${siteName}`}
    onClick={() => onMarkWorked(ids)}
  >Mark all worked</button>;
}

function WeekGridRowView({
  row,
  columns,
  entries,
  locked,
  onMarkWorked,
  onAction,
}: {
  row: WeekGridRow;
  columns: ReturnType<typeof weekGridColumns>;
  entries: WeekGridEntry[];
  locked: boolean;
  onMarkWorked: (ids: string[]) => void;
  onAction: (action: WeekGridMenuAction, entry: WeekGridEntry) => void;
}) {
  const caption = rowScheduleCaption(row.schedule);
  const pendingIds = pendingEntryIds(entries, row.contractorId, row.siteId, columns.map((column) => column.iso));
  return <tr>
    <th scope="row">
      <strong>{row.contractorName}</strong>
      <small>{row.siteName}{caption ? ` · ${caption}` : ""}</small>
      <MarkAllWorked locked={locked} ids={pendingIds} contractorName={row.contractorName} siteName={row.siteName} onMarkWorked={onMarkWorked} />
    </th>
    {columns.map((column, index) => (
      <DesktopDay
        key={column.iso}
        row={row}
        iso={column.iso}
        weekday={WEEKDAY_HEADERS[index] ?? ""}
        entry={entryForCell(entries, row.contractorId, row.siteId, column.iso)}
        locked={locked}
        onMarkWorked={onMarkWorked}
        onAction={onAction}
      />
    ))}
  </tr>;
}

function DesktopDay({
  row,
  iso,
  weekday,
  entry,
  locked,
  onMarkWorked,
  onAction,
}: DayProps) {
  const cell = presentWeekGridCell(entry, row.schedule?.paidMinutes ?? null);
  const noteId = entry ? `shift-note-${entry.id}` : undefined;
  return <td className={cell.className} aria-describedby={entry && visibleShiftNote(entry.notes) ? noteId : undefined}>
    {cell.kind === "empty" ? null : <div className="day-chip">
      <DayInteractive
        row={row}
        iso={iso}
        weekday={weekday}
        entry={entry}
        cell={cell}
        locked={locked}
        noteId={noteId}
        onMarkWorked={onMarkWorked}
        onAction={onAction}
      />
    </div>}
  </td>;
}

function MobileDay({
  row,
  iso,
  weekday,
  entry,
  locked,
  onMarkWorked,
  onAction,
}: DayProps) {
  const cell = presentWeekGridCell(entry, row.schedule?.paidMinutes ?? null);
  const noteId = entry ? `mobile-shift-note-${entry.id}` : undefined;
  return <div className={`week-grid-mobile-day ${cell.className}`} aria-describedby={entry && visibleShiftNote(entry.notes) ? noteId : undefined}>
    <div className="week-grid-mobile-date">
      <span>{weekday}</span>
      <strong>{iso.slice(8)}</strong>
    </div>
    {cell.kind === "empty" ? <strong className="day-empty">No shift</strong> : <DayInteractive
      row={row}
      iso={iso}
      weekday={weekday}
      entry={entry}
      cell={cell}
      locked={locked}
      noteId={noteId}
      onMarkWorked={onMarkWorked}
      onAction={onAction}
    />}
  </div>;
}

type DayProps = {
  row: WeekGridRow;
  iso: string;
  weekday: string;
  entry: WeekGridEntry | null;
  locked: boolean;
  onMarkWorked: (ids: string[]) => void;
  onAction: (action: WeekGridMenuAction, entry: WeekGridEntry) => void;
};

function DayInteractive({
  row,
  iso,
  weekday,
  entry,
  cell,
  locked,
  noteId,
  onMarkWorked,
  onAction,
}: DayProps & { cell: WeekGridCell; noteId: string | undefined }) {
  const dayLabel = `${weekday} ${mobileActionDate(iso)}`;
  const label = cellAriaLabel(cell, { contractorName: row.contractorName, siteName: row.siteName, dayLabel }, locked);
  const press = !locked && cell.tapToMarkWorked && entry ? () => onMarkWorked([entry.id]) : null;
  return <>
    <div className="day-main">
      <DayFace cell={cell} label={label} onPress={press} />
      {entry && noteId ? <ShiftTableNote notes={entry.notes} noteId={noteId} /> : null}
    </div>
    <DayMenu
      locked={locked}
      menu={cell.menu}
      menuLabel={`Actions for ${row.contractorName} at ${row.siteName} on ${dayLabel}`}
      onSelect={(action) => { if (entry) onAction(action, entry); }}
    />
  </>;
}

function DayFace({ cell, label, onPress }: { cell: WeekGridCell; label: string; onPress: (() => void) | null }) {
  const visual = <span aria-hidden="true" className="day-visual">
    {cell.label ? <span className={cell.strike ? "day-minutes is-strike" : "day-minutes"}>{cell.label}</span> : null}
    <span className="day-status"><StatusIcon icon={cell.icon} />{cell.statusLabel}</span>
  </span>;
  if (onPress) {
    return <button type="button" className="day-chip-main" data-state={cell.kind} aria-label={label} onClick={onPress}>{visual}</button>;
  }
  return <div className="day-chip-main" data-state={cell.kind} role="group" aria-label={label}>{visual}</div>;
}

function DayMenu({
  locked,
  menu,
  menuLabel,
  onSelect,
}: {
  locked: boolean;
  menu: WeekGridMenuAction[];
  menuLabel: string;
  onSelect: (action: WeekGridMenuAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (locked || menu.length === 0) return null;
  return <div className="day-menu-wrap" ref={ref}>
    <button type="button" className="day-menu-button" aria-haspopup="menu" aria-expanded={open} aria-label={menuLabel} onClick={() => setOpen((value) => !value)}>⋯</button>
    {open ? <div className="day-menu" role="menu">
      {menu.map((action) => (
        <button type="button" role="menuitem" key={action} onClick={() => { setOpen(false); onSelect(action); }}>{weekGridMenuLabel(action)}</button>
      ))}
    </div> : null}
  </div>;
}

function StatusIcon({ icon }: { icon: WeekGridIcon }) {
  if (icon === "none") return null;
  return <svg viewBox="0 0 16 16" className="day-icon" aria-hidden="true">
    {icon === "pending" ? <circle cx="8" cy="8" r="5.25" fill="none" stroke="currentColor" strokeWidth="1.5" /> : null}
    {icon === "check" ? <path d="M3.5 8.2 6.4 11 12.5 4.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> : null}
    {icon === "changed" ? <path d="M9.2 2.8 13.2 6.8 6.2 13.8H2.2V9.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /> : null}
    {icon === "absent" ? <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : null}
    {icon === "manual" ? <path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /> : null}
  </svg>;
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
