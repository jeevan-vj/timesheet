"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { formatNzd } from "@/lib/shift-entry";
import {
  CONTRACTOR_SUCCESS,
  contractorArchivePrompt,
  contractorContactLabel,
  contractorErrorCopy,
  contractorFormFromResource,
  contractorFormPayload,
  contractorRestoreRequest,
  contractorShowsArchive,
  contractorStatusLabel,
  contractorsListUrl,
  createContractorArchiveFlow,
  createContractorSaveGuard,
  emptyContractorForm,
  emptyContractorsCopy,
  firstInvalidField,
  idleContractorArchive,
  visibleContractors,
  ENGAGEMENT_STATUSES,
  ENGAGEMENT_STATUS_LABELS,
  isEngagementStatus,
  type ContractorArchiveSession,
  type ContractorField,
  type ContractorFormDraft,
  type ContractorResource,
} from "@/lib/contractor-setup";

type FormMode = { kind: "closed" } | { kind: "create" } | { kind: "edit"; id: string };

const FIELD_ERROR_IDS: Record<ContractorField, string> = {
  name: "contractor-name-error",
  email: "contractor-email-error",
  phone: "contractor-phone-error",
  defaultRateCents: "contractor-rate-error",
  preferredName: "contractor-preferred-name-error",
  startDate: "contractor-start-date-error",
  engagementStatus: "contractor-status-error",
  gstRegistered: "contractor-gst-registered-error",
  gstNumber: "contractor-gst-number-error",
  internalNotes: "contractor-notes-error",
  emergencyContactName: "contractor-emergency-name-error",
  emergencyContactPhone: "contractor-emergency-phone-error",
};

async function contractorRequest(url: string, method: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401) {
    window.location.assign("/sign-in");
    throw new Error("unauthorized");
  }
  const data = await response.json().catch(() => ({})) as { error?: string; fields?: Record<string, string>; contractors?: ContractorResource[] };
  if (!response.ok) {
    return { ok: false as const, error: data.error ?? "request_failed", fields: data.fields };
  }
  return { ok: true as const, data };
}

export function ContractorsPanel({
  onNotice,
  onChanged,
}: {
  onNotice: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [contractors, setContractors] = useState<ContractorResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [panelError, setPanelError] = useState("");
  const [formMode, setFormMode] = useState<FormMode>({ kind: "closed" });
  const [draft, setDraft] = useState(emptyContractorForm);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ContractorField, string>>>({});
  const [formAlert, setFormAlert] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [archiveSession, setArchiveSession] = useState(idleContractorArchive);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toggleRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const rateRef = useRef<HTMLInputElement>(null);
  const preferredNameRef = useRef<HTMLInputElement>(null);
  const startDateRef = useRef<HTMLInputElement>(null);
  const statusRef = useRef<HTMLSelectElement>(null);
  const gstNumberRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const emergencyNameRef = useRef<HTMLInputElement>(null);
  const emergencyPhoneRef = useRef<HTMLInputElement>(null);
  const saveGuard = useRef(createContractorSaveGuard()).current;
  const restoreGuard = useRef(createContractorSaveGuard()).current;
  const loadGeneration = useRef(0);
  const includeArchivedRef = useRef(includeArchived);
  includeArchivedRef.current = includeArchived;

  const fieldRefs: Record<ContractorField, { readonly current: { focus: () => void } | null }> = {
    name: nameRef,
    email: emailRef,
    phone: phoneRef,
    defaultRateCents: rateRef,
    preferredName: preferredNameRef,
    startDate: startDateRef,
    engagementStatus: statusRef,
    gstRegistered: gstNumberRef,
    gstNumber: gstNumberRef,
    internalNotes: notesRef,
    emergencyContactName: emergencyNameRef,
    emergencyContactPhone: emergencyPhoneRef,
  };

  const loadList = useCallback(async () => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    setLoading(true);
    try {
      const result = await contractorRequest(contractorsListUrl(includeArchived), "GET");
      if (generation !== loadGeneration.current) return;
      if (!result.ok) {
        setPanelError("Could not load contractors. Please try again.");
        setLoading(false);
        return;
      }
      setContractors(Array.isArray(result.data.contractors) ? result.data.contractors : []);
      setPanelError("");
      setLoading(false);
    } catch {
      if (generation !== loadGeneration.current) return;
      setPanelError("Could not load contractors. Please try again.");
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => { void loadList(); }, [loadList]);

  const archiveSendRef = useRef<(url: string, method: string) => Promise<void>>(async () => undefined);
  archiveSendRef.current = async (url, method) => {
    try {
      const result = await contractorRequest(url, method);
      if (!result.ok) {
        setPanelError(contractorErrorCopy(result).message);
        return;
      }
      setPanelError("");
      await Promise.all([loadList(), onChanged()]);
      onNotice(CONTRACTOR_SUCCESS.archived);
      (includeArchivedRef.current ? toggleRef.current : headingRef.current)?.focus();
    } catch (error) {
      if (error instanceof Error && error.message === "unauthorized") return;
      setPanelError(contractorErrorCopy({ error: "request_failed" }).message);
    }
  };
  const archiveFlow = useRef(createContractorArchiveFlow(async (request) => {
    await archiveSendRef.current(request.url, request.method);
  }, setArchiveSession)).current;

  const rows = visibleContractors(contractors, includeArchived);

  function openCreate() {
    setDraft(emptyContractorForm());
    setFieldErrors({});
    setFormAlert("");
    setFormMode({ kind: "create" });
  }

  function openEdit(contractor: ContractorResource) {
    setDraft(contractorFormFromResource(contractor));
    setFieldErrors({});
    setFormAlert("");
    setFormMode({ kind: "edit", id: contractor.id });
  }

  function closeForm() {
    if (formBusy) return;
    setFormMode({ kind: "closed" });
    setFieldErrors({});
    setFormAlert("");
  }

  function focusFirstInvalid(errors: Partial<Record<ContractorField, string>>) {
    const field = firstInvalidField(errors);
    if (field) fieldRefs[field].current?.focus();
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = contractorFormPayload(draft);
    if (!parsed.ok) {
      setFieldErrors(parsed.fields);
      setFormAlert("");
      focusFirstInvalid(parsed.fields);
      return;
    }
    await saveGuard.run(async () => {
      setFormBusy(true);
      setFieldErrors({});
      setFormAlert("");
      try {
        const editing = formMode.kind === "edit";
        const url = editing ? `/api/contractors/${formMode.id}` : "/api/contractors";
        const method = editing ? "PATCH" : "POST";
        const result = await contractorRequest(url, method, parsed.payload);
        if (!result.ok) {
          const copy = contractorErrorCopy(result);
          setFieldErrors(copy.fields);
          if (Object.keys(copy.fields).length) {
            setFormAlert("");
            focusFirstInvalid(copy.fields);
          } else {
            setFormAlert(copy.message);
          }
          return;
        }
        setFormMode({ kind: "closed" });
        await Promise.all([loadList(), onChanged()]);
        onNotice(editing ? CONTRACTOR_SUCCESS.updated : CONTRACTOR_SUCCESS.added);
        headingRef.current?.focus();
      } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") return;
        setFormAlert(contractorErrorCopy({ error: "request_failed" }).message);
      } finally {
        setFormBusy(false);
      }
    });
  }

  async function restore(contractor: ContractorResource) {
    await restoreGuard.run(async () => {
      setPanelError("");
      try {
        const request = contractorRestoreRequest(contractor.id);
        const result = await contractorRequest(request.url, request.method);
        if (!result.ok) {
          setPanelError(contractorErrorCopy(result).message);
          return;
        }
        await Promise.all([loadList(), onChanged()]);
        onNotice(CONTRACTOR_SUCCESS.restored);
        (includeArchived ? toggleRef.current : headingRef.current)?.focus();
      } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") return;
        setPanelError(contractorErrorCopy({ error: "request_failed" }).message);
      }
    });
  }

  return <article className="setup-card contractors-panel">
    <div className="setup-title">
      <h3 ref={headingRef} tabIndex={-1} id="contractors-heading">Contractors</h3>
      <span>{rows.length}</span>
    </div>
    <label className="archived-toggle">
      <input
        ref={toggleRef}
        type="checkbox"
        checked={includeArchived}
        onChange={(event) => setIncludeArchived(event.target.checked)}
      />
      Show archived contractors
    </label>
    {panelError ? <p className="alert" role="alert">{panelError} <button type="button" className="link-button" onClick={() => void loadList()}>Try again</button></p> : null}
    {loading && !contractors.length ? <p className="muted" role="status">Loading contractors…</p> : null}
    <div className="compact-list">
      {!loading && !rows.length ? (
        <div className="empty contractor-empty">
          <h3>{emptyContractorsCopy(includeArchived)}</h3>
          <p>{includeArchived ? "Archived people stay on historical weeks." : "Add each contractor once, then assign them to sites."}</p>
          <button type="button" className="button small" onClick={openCreate}>Add contractor</button>
        </div>
      ) : rows.map((contractor) => (
        <ContractorRow
          key={contractor.id}
          contractor={contractor}
          busy={archiveSession.phase === "submitting"}
          onEdit={() => openEdit(contractor)}
          onArchive={() => archiveFlow.request({ id: contractor.id, name: contractor.name })}
          onRestore={() => void restore(contractor)}
        />
      ))}
    </div>
    {rows.length ? <button type="button" className="add-contractor" onClick={openCreate}>+ Add contractor</button> : null}
    <ContractorFormDialog
      open={formMode.kind !== "closed"}
      mode={formMode.kind === "edit" ? "edit" : "create"}
      draft={draft}
      fieldErrors={fieldErrors}
      formAlert={formAlert}
      busy={formBusy}
      nameRef={nameRef}
      emailRef={emailRef}
      phoneRef={phoneRef}
      rateRef={rateRef}
      preferredNameRef={preferredNameRef}
      startDateRef={startDateRef}
      statusRef={statusRef}
      gstNumberRef={gstNumberRef}
      notesRef={notesRef}
      emergencyNameRef={emergencyNameRef}
      emergencyPhoneRef={emergencyPhoneRef}
      onChange={setDraft}
      onClose={closeForm}
      onSubmit={submitForm}
    />
    <ArchiveContractorDialog session={archiveSession} onCancel={() => archiveFlow.cancel()} onConfirm={() => void archiveFlow.confirm()} />
  </article>;
}

function ContractorRow({
  contractor,
  busy,
  onEdit,
  onArchive,
  onRestore,
}: {
  contractor: ContractorResource;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return <div className="compact-row contractor-row" data-engagement-status={contractor.engagementStatus}>
    <div>
      <strong>{contractor.name}</strong>
      {contractor.preferredName.trim() ? <small>Preferred name: {contractor.preferredName}</small> : null}
      <small>{contractorContactLabel(contractor)}</small>
      <small>{formatNzd(contractor.defaultRateCents)}/hr · {contractor.currency} · {contractorStatusLabel(contractor.engagementStatus)}</small>
      {contractor.startDate ? <small>Start date {contractor.startDate}</small> : null}
      {contractor.gstRegistered ? <small>{contractor.gstNumber ? `GST ${contractor.gstNumber}` : "GST registered"}</small> : null}
      {contractor.emergencyContactName.trim() || contractor.emergencyContactPhone.trim()
        ? <small>Emergency: {[contractor.emergencyContactName.trim(), contractor.emergencyContactPhone.trim()].filter(Boolean).join(" · ")}</small>
        : null}
      {contractor.internalNotes.trim() ? <details>
        <summary>Internal notes</summary>
        <small className="contractor-notes">{contractor.internalNotes}</small>
      </details> : null}
    </div>
    <div className="contractor-row-actions">
      <button type="button" className="button small secondary" onClick={onEdit} aria-label={`Edit ${contractor.name}`}>Edit</button>
      {contractorShowsArchive(contractor.engagementStatus)
        ? <button type="button" className="button small secondary" onClick={onArchive} disabled={busy} aria-label={`Archive ${contractor.name}`}>Archive</button>
        : <button type="button" className="button small secondary" onClick={onRestore} disabled={busy} aria-label={`Restore ${contractor.name}`}>Restore</button>}
    </div>
  </div>;
}

function ContractorFormDialog({
  open,
  mode,
  draft,
  fieldErrors,
  formAlert,
  busy,
  nameRef,
  emailRef,
  phoneRef,
  rateRef,
  preferredNameRef,
  startDateRef,
  statusRef,
  gstNumberRef,
  notesRef,
  emergencyNameRef,
  emergencyPhoneRef,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  draft: ContractorFormDraft;
  fieldErrors: Partial<Record<ContractorField, string>>;
  formAlert: string;
  busy: boolean;
  nameRef: RefObject<HTMLInputElement | null>;
  emailRef: RefObject<HTMLInputElement | null>;
  phoneRef: RefObject<HTMLInputElement | null>;
  rateRef: RefObject<HTMLInputElement | null>;
  preferredNameRef: RefObject<HTMLInputElement | null>;
  startDateRef: RefObject<HTMLInputElement | null>;
  statusRef: RefObject<HTMLSelectElement | null>;
  gstNumberRef: RefObject<HTMLInputElement | null>;
  notesRef: RefObject<HTMLTextAreaElement | null>;
  emergencyNameRef: RefObject<HTMLInputElement | null>;
  emergencyPhoneRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: ContractorFormDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const title = mode === "edit" ? "Edit contractor" : "Add contractor";
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [open]);

  function describedBy(field: ContractorField) {
    return fieldErrors[field] ? FIELD_ERROR_IDS[field] : undefined;
  }

  return <dialog
    ref={dialogRef}
    className="modal contractor-form-dialog"
    aria-labelledby="contractor-form-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
  >
    {open ? <form className="mini-form contractor-form" data-feature="contractor-engagement" noValidate onSubmit={onSubmit}>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Team</p>
          <h2 id="contractor-form-title">{title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close contractor form" onClick={onClose} disabled={busy}>×</button>
      </div>
      {formAlert ? <p className="alert" role="alert">{formAlert}</p> : null}
      <label>Name
        <input
          ref={nameRef}
          autoFocus
          required
          maxLength={100}
          value={draft.name}
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={describedBy("name")}
          onChange={(event) => onChange({ ...draft, name: event.target.value })}
        />
      </label>
      {fieldErrors.name ? <p className="field-error" id={FIELD_ERROR_IDS.name} role="alert">{fieldErrors.name}</p> : null}
      <label>Email <small>Optional</small>
        <input
          ref={emailRef}
          type="email"
          maxLength={254}
          value={draft.email}
          aria-invalid={Boolean(fieldErrors.email)}
          aria-describedby={describedBy("email")}
          onChange={(event) => onChange({ ...draft, email: event.target.value })}
        />
      </label>
      {fieldErrors.email ? <p className="field-error" id={FIELD_ERROR_IDS.email} role="alert">{fieldErrors.email}</p> : null}
      <label>Phone <small>Optional</small>
        <input
          ref={phoneRef}
          maxLength={40}
          value={draft.phone}
          aria-invalid={Boolean(fieldErrors.phone)}
          aria-describedby={describedBy("phone")}
          onChange={(event) => onChange({ ...draft, phone: event.target.value })}
        />
      </label>
      {fieldErrors.phone ? <p className="field-error" id={FIELD_ERROR_IDS.phone} role="alert">{fieldErrors.phone}</p> : null}
      <label>Default hourly rate (NZD)
        <input
          ref={rateRef}
          type="number"
          inputMode="decimal"
          min={15}
          max={250}
          step="0.01"
          required
          value={draft.rateDollars}
          aria-invalid={Boolean(fieldErrors.defaultRateCents)}
          aria-describedby={describedBy("defaultRateCents")}
          onChange={(event) => onChange({ ...draft, rateDollars: event.target.value })}
        />
      </label>
      {fieldErrors.defaultRateCents ? <p className="field-error" id={FIELD_ERROR_IDS.defaultRateCents} role="alert">{fieldErrors.defaultRateCents}</p> : null}
      <label>Preferred name <small>Optional</small>
        <input
          ref={preferredNameRef}
          maxLength={100}
          value={draft.preferredName}
          aria-invalid={Boolean(fieldErrors.preferredName)}
          aria-describedby={describedBy("preferredName")}
          onChange={(event) => onChange({ ...draft, preferredName: event.target.value })}
        />
      </label>
      {fieldErrors.preferredName ? <p className="field-error" id={FIELD_ERROR_IDS.preferredName} role="alert">{fieldErrors.preferredName}</p> : null}
      <label>Start date <small>Optional</small>
        <input
          ref={startDateRef}
          type="date"
          value={draft.startDate}
          aria-invalid={Boolean(fieldErrors.startDate)}
          aria-describedby={describedBy("startDate")}
          onChange={(event) => onChange({ ...draft, startDate: event.target.value })}
        />
      </label>
      {fieldErrors.startDate ? <p className="field-error" id={FIELD_ERROR_IDS.startDate} role="alert">{fieldErrors.startDate}</p> : null}
      <label>Engagement status
        <select
          ref={statusRef}
          value={draft.engagementStatus}
          aria-invalid={Boolean(fieldErrors.engagementStatus)}
          aria-describedby={fieldErrors.engagementStatus ? FIELD_ERROR_IDS.engagementStatus : "contractor-status-help"}
          onChange={(event) => {
            const engagementStatus = event.target.value;
            if (!isEngagementStatus(engagementStatus)) return;
            onChange({ ...draft, engagementStatus });
          }}
        >
          {ENGAGEMENT_STATUSES.map((status) => <option key={status} value={status}>{ENGAGEMENT_STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      <p className="field-help" id="contractor-status-help">Draft, suspended, and archived contractors cannot be added to new shifts. Choosing Archived also removes them from assignment lists. Invited and Active can be scheduled.</p>
      {fieldErrors.engagementStatus ? <p className="field-error" id={FIELD_ERROR_IDS.engagementStatus} role="alert">{fieldErrors.engagementStatus}</p> : null}
      <label className="archived-toggle contractor-gst-toggle">
        <input
          type="checkbox"
          checked={draft.gstRegistered}
          onChange={(event) => onChange({ ...draft, gstRegistered: event.target.checked })}
        />
        GST registered
      </label>
      <label>GST number <small>Optional. 8 or 9 digits; spaces and hyphens are removed</small>
        <input
          ref={gstNumberRef}
          inputMode="numeric"
          maxLength={20}
          value={draft.gstNumber}
          aria-invalid={Boolean(fieldErrors.gstNumber)}
          aria-describedby={describedBy("gstNumber")}
          onChange={(event) => onChange({ ...draft, gstNumber: event.target.value })}
        />
      </label>
      {fieldErrors.gstNumber ? <p className="field-error" id={FIELD_ERROR_IDS.gstNumber} role="alert">{fieldErrors.gstNumber}</p> : null}
      <label>Internal notes <small>Optional, owner only</small>
        <textarea
          ref={notesRef}
          maxLength={2000}
          rows={3}
          value={draft.internalNotes}
          aria-invalid={Boolean(fieldErrors.internalNotes)}
          aria-describedby={describedBy("internalNotes")}
          onChange={(event) => onChange({ ...draft, internalNotes: event.target.value })}
        />
      </label>
      {fieldErrors.internalNotes ? <p className="field-error" id={FIELD_ERROR_IDS.internalNotes} role="alert">{fieldErrors.internalNotes}</p> : null}
      <label>Emergency contact name <small>Optional</small>
        <input
          ref={emergencyNameRef}
          maxLength={100}
          value={draft.emergencyContactName}
          aria-invalid={Boolean(fieldErrors.emergencyContactName)}
          aria-describedby={describedBy("emergencyContactName")}
          onChange={(event) => onChange({ ...draft, emergencyContactName: event.target.value })}
        />
      </label>
      {fieldErrors.emergencyContactName ? <p className="field-error" id={FIELD_ERROR_IDS.emergencyContactName} role="alert">{fieldErrors.emergencyContactName}</p> : null}
      <label>Emergency contact phone <small>Optional</small>
        <input
          ref={emergencyPhoneRef}
          maxLength={40}
          value={draft.emergencyContactPhone}
          aria-invalid={Boolean(fieldErrors.emergencyContactPhone)}
          aria-describedby={describedBy("emergencyContactPhone")}
          onChange={(event) => onChange({ ...draft, emergencyContactPhone: event.target.value })}
        />
      </label>
      {fieldErrors.emergencyContactPhone ? <p className="field-error" id={FIELD_ERROR_IDS.emergencyContactPhone} role="alert">{fieldErrors.emergencyContactPhone}</p> : null}
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button" disabled={busy} aria-busy={busy}>{busy ? "Saving…" : mode === "edit" ? "Save changes" : "Save contractor"}</button>
      </div>
    </form> : null}
  </dialog>;
}

function ArchiveContractorDialog({ session, onCancel, onConfirm }: { session: ContractorArchiveSession; onCancel: () => void; onConfirm: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const busy = session.phase === "submitting";
  const target = session.target;
  const prompt = target ? contractorArchivePrompt(target) : null;
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (target && !node.open) node.showModal();
    if (!target && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [target]);
  return <dialog
    ref={dialogRef}
    className="modal delete-shift-dialog"
    aria-labelledby="archive-contractor-title"
    aria-describedby="archive-contractor-copy"
    onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }}
    onClick={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}
  >
    {prompt ? <>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Archive contractor</p>
          <h2 id="archive-contractor-title">{prompt.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label={prompt.closeLabel} onClick={onCancel} disabled={busy}>×</button>
      </div>
      <p id="archive-contractor-copy">{prompt.description}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" autoFocus onClick={onCancel} disabled={busy}>{prompt.cancelLabel}</button>
        <button type="button" className="button danger" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirmLabel}</button>
      </div>
    </> : null}
  </dialog>;
}
