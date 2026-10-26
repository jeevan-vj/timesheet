"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { formatNzd } from "@/lib/shift-entry";
import { ContractorInvitation } from "@/components/contractor-invitation";
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
          onInvitationChanged={async () => { await Promise.all([loadList(), onChanged()]); }}
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
  onInvitationChanged,
}: {
  contractor: ContractorResource;
  busy: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onInvitationChanged: () => Promise<void>;
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
      <ContractorInvitation
        contractorId={contractor.id}
        contractorName={contractor.name}
        email={contractor.email}
        engagementStatus={contractor.engagementStatus}
        onChanged={onInvitationChanged}
      />
    </div>
    <div className="contractor-row-actions">
      <button type="button" className="button small secondary" onClick={onEdit} aria-label={`Edit ${contractor.name}`}>Edit</button>
      {contractorShowsArchive(contractor.engagementStatus)
        ? <button type="button" className="button small secondary" onClick={onArchive} disabled={busy} aria-label={`Archive ${contractor.name}`}>Archive</button>
        : <button type="button" className="button small secondary" onClick={onRestore} disabled={busy} aria-label={`Restore ${contractor.name}`}>Restore</button>}
    </div>
  </div>;
}

type ContractorFieldErrors = Partial<Record<ContractorField, string>>;
type ContractorFormMode = "create" | "edit";

function fieldDescribedBy(field: ContractorField, message: string | undefined) {
  if (!message) return undefined;
  return FIELD_ERROR_IDS[field];
}

function statusDescribedBy(message: string | undefined) {
  if (message) return FIELD_ERROR_IDS.engagementStatus;
  return "contractor-status-help";
}

function saveContractorLabel(busy: boolean, mode: ContractorFormMode) {
  if (busy) return "Saving…";
  if (mode === "edit") return "Save changes";
  return "Save contractor";
}

function contractorDialogTitle(mode: ContractorFormMode) {
  if (mode === "edit") return "Edit contractor";
  return "Add contractor";
}

function applyEngagementStatus(draft: ContractorFormDraft, value: string, onChange: (draft: ContractorFormDraft) => void) {
  if (!isEngagementStatus(value)) return;
  onChange({ ...draft, engagementStatus: value });
}

function closeContractorDialogOnBackdrop(event: MouseEvent<HTMLDialogElement>, busy: boolean, onClose: () => void) {
  if (event.target !== event.currentTarget) return;
  if (busy) return;
  onClose();
}

function useContractorDialog(open: boolean) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialogRef.current;
    syncContractorDialog(node, open);
    return () => closeContractorDialog(node);
  }, [open]);
  return dialogRef;
}

function syncContractorDialog(node: HTMLDialogElement | null, open: boolean) {
  if (!node) return;
  if (open) {
    if (!node.open) node.showModal();
    return;
  }
  if (node.open) node.close();
}

function closeContractorDialog(node: HTMLDialogElement | null) {
  if (node?.open) node.close();
}

function FieldError({ field, message }: Readonly<{ field: ContractorField; message: string | undefined }>) {
  if (!message) return null;
  return <p className="field-error" id={FIELD_ERROR_IDS[field]} role="alert">{message}</p>;
}

function ContractorTextField({
  label,
  hint,
  field,
  value,
  message,
  inputRef,
  maxLength,
  type,
  required,
  autoFocus,
  inputMode,
  onValue,
}: Readonly<{
  label: string;
  hint?: string;
  field: ContractorField;
  value: string;
  message: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  maxLength?: number;
  type?: string;
  required?: boolean;
  autoFocus?: boolean;
  inputMode?: "numeric";
  onValue: (value: string) => void;
}>) {
  return <>
    <label>{label}{hint ? <> <small>{hint}</small></> : null}
      <input
        ref={inputRef}
        type={type}
        autoFocus={autoFocus}
        required={required}
        inputMode={inputMode}
        maxLength={maxLength}
        value={value}
        aria-invalid={Boolean(message)}
        aria-describedby={fieldDescribedBy(field, message)}
        onChange={(event) => onValue(event.target.value)}
      />
    </label>
    <FieldError field={field} message={message} />
  </>;
}

function ContractorRateField({
  value,
  message,
  inputRef,
  onValue,
}: Readonly<{
  value: string;
  message: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  onValue: (value: string) => void;
}>) {
  return <>
    <label>Default hourly rate (NZD)
      <input
        ref={inputRef}
        type="number"
        inputMode="decimal"
        min={15}
        max={250}
        step="0.01"
        required
        value={value}
        aria-invalid={Boolean(message)}
        aria-describedby={fieldDescribedBy("defaultRateCents", message)}
        onChange={(event) => onValue(event.target.value)}
      />
    </label>
    <FieldError field="defaultRateCents" message={message} />
  </>;
}

function ContractorIdentityFields({
  draft,
  fieldErrors,
  nameRef,
  emailRef,
  phoneRef,
  rateRef,
  onChange,
}: Readonly<{
  draft: ContractorFormDraft;
  fieldErrors: ContractorFieldErrors;
  nameRef: RefObject<HTMLInputElement | null>;
  emailRef: RefObject<HTMLInputElement | null>;
  phoneRef: RefObject<HTMLInputElement | null>;
  rateRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: ContractorFormDraft) => void;
}>) {
  return <>
    <ContractorTextField
      label="Name"
      field="name"
      value={draft.name}
      message={fieldErrors.name}
      inputRef={nameRef}
      maxLength={100}
      required
      autoFocus
      onValue={(name) => onChange({ ...draft, name })}
    />
    <ContractorTextField
      label="Email"
      hint="Optional"
      field="email"
      type="email"
      value={draft.email}
      message={fieldErrors.email}
      inputRef={emailRef}
      maxLength={254}
      onValue={(email) => onChange({ ...draft, email })}
    />
    <ContractorTextField
      label="Phone"
      hint="Optional"
      field="phone"
      value={draft.phone}
      message={fieldErrors.phone}
      inputRef={phoneRef}
      maxLength={40}
      onValue={(phone) => onChange({ ...draft, phone })}
    />
    <ContractorRateField
      value={draft.rateDollars}
      message={fieldErrors.defaultRateCents}
      inputRef={rateRef}
      onValue={(rateDollars) => onChange({ ...draft, rateDollars })}
    />
  </>;
}

function ContractorStatusField({
  draft,
  message,
  inputRef,
  onChange,
}: Readonly<{
  draft: ContractorFormDraft;
  message: string | undefined;
  inputRef: RefObject<HTMLSelectElement | null>;
  onChange: (draft: ContractorFormDraft) => void;
}>) {
  return <>
    <label>Engagement status
      <select
        ref={inputRef}
        value={draft.engagementStatus}
        aria-invalid={Boolean(message)}
        aria-describedby={statusDescribedBy(message)}
        onChange={(event) => applyEngagementStatus(draft, event.target.value, onChange)}
      >
        {ENGAGEMENT_STATUSES.map((status) => <option key={status} value={status}>{ENGAGEMENT_STATUS_LABELS[status]}</option>)}
      </select>
    </label>
    <p className="field-help" id="contractor-status-help">Draft, suspended, and archived contractors cannot be added to new shifts. Choosing Archived also removes them from assignment lists. Invited and Active can be scheduled.</p>
    <FieldError field="engagementStatus" message={message} />
  </>;
}

function ContractorGstFields({
  draft,
  message,
  inputRef,
  onChange,
}: Readonly<{
  draft: ContractorFormDraft;
  message: string | undefined;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: ContractorFormDraft) => void;
}>) {
  return <>
    <label className="archived-toggle contractor-gst-toggle">
      <input
        type="checkbox"
        checked={draft.gstRegistered}
        onChange={(event) => onChange({ ...draft, gstRegistered: event.target.checked })}
      />
      GST registered
    </label>
    <ContractorTextField
      label="GST number"
      hint="Optional. 8 or 9 digits; spaces and hyphens are removed"
      field="gstNumber"
      value={draft.gstNumber}
      message={message}
      inputRef={inputRef}
      maxLength={20}
      inputMode="numeric"
      onValue={(gstNumber) => onChange({ ...draft, gstNumber })}
    />
  </>;
}

function ContractorNotesField({
  value,
  message,
  inputRef,
  onValue,
}: Readonly<{
  value: string;
  message: string | undefined;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onValue: (value: string) => void;
}>) {
  return <>
    <label>Internal notes <small>Optional, owner only</small>
      <textarea
        ref={inputRef}
        maxLength={2000}
        rows={3}
        value={value}
        aria-invalid={Boolean(message)}
        aria-describedby={fieldDescribedBy("internalNotes", message)}
        onChange={(event) => onValue(event.target.value)}
      />
    </label>
    <FieldError field="internalNotes" message={message} />
  </>;
}

function ContractorEngagementFields({
  draft,
  fieldErrors,
  preferredNameRef,
  startDateRef,
  statusRef,
  gstNumberRef,
  notesRef,
  emergencyNameRef,
  emergencyPhoneRef,
  onChange,
}: Readonly<{
  draft: ContractorFormDraft;
  fieldErrors: ContractorFieldErrors;
  preferredNameRef: RefObject<HTMLInputElement | null>;
  startDateRef: RefObject<HTMLInputElement | null>;
  statusRef: RefObject<HTMLSelectElement | null>;
  gstNumberRef: RefObject<HTMLInputElement | null>;
  notesRef: RefObject<HTMLTextAreaElement | null>;
  emergencyNameRef: RefObject<HTMLInputElement | null>;
  emergencyPhoneRef: RefObject<HTMLInputElement | null>;
  onChange: (draft: ContractorFormDraft) => void;
}>) {
  return <>
    <ContractorTextField
      label="Preferred name"
      hint="Optional"
      field="preferredName"
      value={draft.preferredName}
      message={fieldErrors.preferredName}
      inputRef={preferredNameRef}
      maxLength={100}
      onValue={(preferredName) => onChange({ ...draft, preferredName })}
    />
    <ContractorTextField
      label="Start date"
      hint="Optional"
      field="startDate"
      type="date"
      value={draft.startDate}
      message={fieldErrors.startDate}
      inputRef={startDateRef}
      onValue={(startDate) => onChange({ ...draft, startDate })}
    />
    <ContractorStatusField draft={draft} message={fieldErrors.engagementStatus} inputRef={statusRef} onChange={onChange} />
    <ContractorGstFields draft={draft} message={fieldErrors.gstNumber} inputRef={gstNumberRef} onChange={onChange} />
    <ContractorNotesField
      value={draft.internalNotes}
      message={fieldErrors.internalNotes}
      inputRef={notesRef}
      onValue={(internalNotes) => onChange({ ...draft, internalNotes })}
    />
    <ContractorTextField
      label="Emergency contact name"
      hint="Optional"
      field="emergencyContactName"
      value={draft.emergencyContactName}
      message={fieldErrors.emergencyContactName}
      inputRef={emergencyNameRef}
      maxLength={100}
      onValue={(emergencyContactName) => onChange({ ...draft, emergencyContactName })}
    />
    <ContractorTextField
      label="Emergency contact phone"
      hint="Optional"
      field="emergencyContactPhone"
      value={draft.emergencyContactPhone}
      message={fieldErrors.emergencyContactPhone}
      inputRef={emergencyPhoneRef}
      maxLength={40}
      onValue={(emergencyContactPhone) => onChange({ ...draft, emergencyContactPhone })}
    />
  </>;
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
}: Readonly<{
  open: boolean;
  mode: ContractorFormMode;
  draft: ContractorFormDraft;
  fieldErrors: ContractorFieldErrors;
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
}>) {
  const dialogRef = useContractorDialog(open);
  return <dialog
    ref={dialogRef}
    className="modal contractor-form-dialog"
    aria-labelledby="contractor-form-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => closeContractorDialogOnBackdrop(event, busy, onClose)}
  >
    {open ? <form className="mini-form contractor-form" data-feature="contractor-engagement" noValidate onSubmit={onSubmit}>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Team</p>
          <h2 id="contractor-form-title">{contractorDialogTitle(mode)}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close contractor form" onClick={onClose} disabled={busy}>×</button>
      </div>
      {formAlert ? <p className="alert" role="alert">{formAlert}</p> : null}
      <ContractorIdentityFields
        draft={draft}
        fieldErrors={fieldErrors}
        nameRef={nameRef}
        emailRef={emailRef}
        phoneRef={phoneRef}
        rateRef={rateRef}
        onChange={onChange}
      />
      <ContractorEngagementFields
        draft={draft}
        fieldErrors={fieldErrors}
        preferredNameRef={preferredNameRef}
        startDateRef={startDateRef}
        statusRef={statusRef}
        gstNumberRef={gstNumberRef}
        notesRef={notesRef}
        emergencyNameRef={emergencyNameRef}
        emergencyPhoneRef={emergencyPhoneRef}
        onChange={onChange}
      />
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button" disabled={busy} aria-busy={busy}>{saveContractorLabel(busy, mode)}</button>
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
