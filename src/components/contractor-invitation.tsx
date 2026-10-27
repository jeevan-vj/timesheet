"use client";

import { useEffect, useRef, useState } from "react";
import { contractorMayHoldPortalAccess, type EngagementStatus } from "@/lib/contractor-lifecycle";
import type { InvitationDelivery, InvitationView } from "@/lib/invitation-view";
import {
  invitationActions,
  invitationBadge,
  invitationDeliveryNotice,
  invitationErrorMessage,
  invitationPrompt,
  parseInvitationView,
  type InvitationAction,
  type InvitationPrompt,
} from "@/lib/invitation-ui";

type Issued = { view: InvitationView; delivery: InvitationDelivery; inviteLink: string };

export function ContractorInvitation({
  contractorId,
  contractorName,
  email,
  engagementStatus,
  onChanged,
}: {
  contractorId: string;
  contractorName: string;
  email: string;
  engagementStatus: EngagementStatus;
  onChanged: () => Promise<void>;
}) {
  const eligible = contractorMayHoldPortalAccess(engagementStatus) && email.trim() !== "";
  const [view, setView] = useState<InvitationView | null>(null);
  const [inviteLink, setInviteLink] = useState("");
  const [notice, setNotice] = useState("");
  const [delivery, setDelivery] = useState<InvitationDelivery | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<InvitationPrompt | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const current = generation.current + 1;
    generation.current = current;
    setInviteLink("");
    setNotice("");
    setDelivery(null);
    void loadInvitation(contractorId).then((next) => {
      if (generation.current !== current) return;
      setView(next);
    });
  }, [contractorId]);

  const state = view?.state ?? "none";
  const actions = view ? invitationActions({ state, eligible, hasLink: inviteLink !== "" }) : [];

  async function confirm() {
    if (!prompt) return;
    const action = prompt.action;
    setPrompt(null);
    setBusy(true);
    setError("");
    try {
      const result = await postInvitation(contractorId, action, email);
      if (!result.ok) {
        if (result.view) setView(result.view);
        setError(invitationErrorMessage(result.error));
        return;
      }
      setView(result.view);
      setInviteLink(result.inviteLink);
      setDelivery(result.delivery);
      setNotice(result.notice);
      await onChanged();
    } catch (caught) {
      if (caught instanceof Error && caught.message === "unauthorized") return;
      setError(invitationErrorMessage("request_failed"));
    } finally {
      setBusy(false);
    }
  }

  return <div className="contractor-invitation" data-feature="contractor-invitation">
    <span className="access-badge">{invitationBadge(state, contractorMayHoldPortalAccess(engagementStatus))}</span>
    {notice ? <p className="assignment-notice is-ok" role="status" data-feature="invitation-delivery" data-delivery={delivery ?? undefined}>{notice}</p> : null}
    {error ? <p className="assignment-notice is-error" role="alert">{error}</p> : null}
    {inviteLink ? <input className="invite-link-field" readOnly value={inviteLink} aria-label="Invitation link" /> : null}
    {!email.trim() && contractorMayHoldPortalAccess(engagementStatus) ? <small>Add an email address before sending an invitation.</small> : null}
    <div className="contractor-row-actions">
      {actions.map((action) => <InvitationButton key={action} action={action} busy={busy} name={contractorName} onAsk={setPrompt} onCopy={() => copyInvitationLink(inviteLink, setNotice, setError)} />)}
    </div>
    <InvitationConfirm prompt={prompt} busy={busy} onCancel={() => setPrompt(null)} onConfirm={() => void confirm()} />
  </div>;
}

function InvitationButton({
  action,
  busy,
  name,
  onAsk,
  onCopy,
}: {
  action: InvitationAction;
  busy: boolean;
  name: string;
  onAsk: (prompt: InvitationPrompt) => void;
  onCopy: () => void;
}) {
  if (action === "copy") {
    return <button type="button" className="button small secondary" disabled={busy} onClick={onCopy}>Copy link</button>;
  }
  const label = action === "invite" ? "Invite" : action === "resend" ? "Resend" : "Revoke";
  return <button type="button" className="button small secondary" disabled={busy} aria-label={`${label} ${name}`} onClick={() => onAsk(invitationPrompt(action, name))}>{label}</button>;
}

async function loadInvitation(contractorId: string): Promise<InvitationView | null> {
  try {
    const response = await fetch(`/api/contractors/${contractorId}/invitation`, { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/sign-in");
      return null;
    }
    if (!response.ok) return null;
    return parseInvitationView(await response.json());
  } catch {
    return null;
  }
}

async function postInvitation(contractorId: string, action: InvitationPrompt["action"], email: string): Promise<
  { ok: true; view: InvitationView; delivery: InvitationDelivery | null; inviteLink: string; notice: string }
  | { ok: false; error: string; view: InvitationView | null }
> {
  const response = await fetch(invitationUrl(contractorId, action), { method: "POST", cache: "no-store" });
  if (response.status === 401) throw new Error("unauthorized");
  const body = await response.json().catch(() => ({})) as { error?: string; invitation?: unknown; delivery?: unknown; inviteLink?: unknown };
  const view = parseInvitationView(body.invitation);
  if (!response.ok) return { ok: false, error: body.error ?? "request_failed", view };
  if (action === "revoke") return { ok: true, view: view ?? fallbackView("revoked"), delivery: null, inviteLink: "", notice: "Invitation revoked." };
  return issuedResult(body, view, email);
}

function invitationUrl(contractorId: string, action: InvitationPrompt["action"]): string {
  if (action === "resend") return `/api/contractors/${contractorId}/invitation/resend`;
  if (action === "revoke") return `/api/contractors/${contractorId}/invitation/revoke`;
  return `/api/contractors/${contractorId}/invitation`;
}

function issuedResult(
  body: { delivery?: unknown; inviteLink?: unknown },
  view: InvitationView | null,
  email: string,
): { ok: true; view: InvitationView; delivery: InvitationDelivery | null; inviteLink: string; notice: string } | { ok: false; error: string; view: InvitationView | null } {
  const parsed = parseIssued(body, view);
  if (!parsed) return { ok: false, error: "request_failed", view };
  return { ok: true, ...parsed, notice: invitationDeliveryNotice(parsed.delivery, email) };
}

function parseIssued(body: { delivery?: unknown; inviteLink?: unknown }, view: InvitationView | null): Issued | null {
  if (!view || typeof body.inviteLink !== "string") return null;
  if (body.delivery !== "email" && body.delivery !== "link_only" && body.delivery !== "email_failed") return null;
  return { view, delivery: body.delivery, inviteLink: body.inviteLink };
}

function fallbackView(state: "revoked"): InvitationView {
  return { state, expiresAt: null, sendCount: null, lastDelivery: null };
}

async function copyInvitationLink(inviteLink: string, setNotice: (notice: string) => void, setError: (error: string) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(inviteLink);
    setError("");
    setNotice("Link copied.");
  } catch {
    setError("Could not copy the link. Select it and copy it manually.");
  }
}

function InvitationConfirm({
  prompt,
  busy,
  onCancel,
  onConfirm,
}: {
  prompt: InvitationPrompt | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (prompt && !node.open) node.showModal();
    if (!prompt && node.open) node.close();
    return () => { if (node.open) node.close(); };
  }, [prompt]);
  return <dialog ref={dialogRef} className="modal delete-shift-dialog" aria-labelledby="invitation-confirm-title" onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }}>
    {prompt ? <>
      <div className="modal-title">
        <div>
          <p className="eyebrow">Portal invitation</p>
          <h2 id="invitation-confirm-title">{prompt.title}</h2>
        </div>
        <button type="button" className="icon-button" aria-label="Close invitation confirmation" onClick={onCancel} disabled={busy}>×</button>
      </div>
      <p>{prompt.description}</p>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={onCancel} disabled={busy}>{prompt.cancel}</button>
        <button type="button" className="button" onClick={onConfirm} disabled={busy} aria-busy={busy}>{prompt.confirm}</button>
      </div>
    </> : null}
  </dialog>;
}
