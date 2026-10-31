"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { authClient } from "@/lib/auth-client";
import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";
import {
  acceptErrorCopy,
  inviteClosedCopy,
  inviteScreen,
  isClosedInviteState,
  passwordStrengthHint,
  type ClosedInviteState,
  type InviteScreen,
} from "@/lib/invite-public";

const TOKEN_KEY = "cleantrack.invite";

type Model =
  | { phase: "loading" }
  | { phase: "message"; message: string }
  | { phase: "closed"; state: ClosedInviteState }
  | { phase: "ready"; token: string; screen: Extract<InviteScreen, { kind: "ready" }>; message: string };

export function InviteAccept() {
  const [model, setModel] = useState<Model>({ phase: "loading" });
  useEffect(() => { void loadInvite(setModel); }, []);
  return <AuthShell><InviteBody model={model} setModel={setModel} /></AuthShell>;
}

function InviteBody({ model, setModel }: { model: Model; setModel: (model: Model) => void }) {
  if (model.phase === "loading") return <p role="status">Checking your invitation…</p>;
  if (model.phase === "message") return <p className="alert" role="alert">{model.message}</p>;
  if (model.phase === "closed") return <ClosedInvite state={model.state} />;
  if (model.screen.mode === "setup") return <SetupForm model={model} setModel={setModel} />;
  if (model.screen.mode === "sign_in") return <SignInPrompt model={model} />;
  if (model.screen.mode === "mismatch") return <Mismatch model={model} setModel={setModel} />;
  return <Accepting model={model} setModel={setModel} />;
}

function ClosedInvite({ state }: { state: ClosedInviteState }) {
  const copy = inviteClosedCopy(state);
  return <div data-feature="invite-closed" data-state={state}>
    <p className="eyebrow">Invitation</p>
    <h1>{copy.title}</h1>
    <p className="muted">{copy.hint}</p>
  </div>;
}

function SetupForm({ model, setModel }: { model: Extract<Model, { phase: "ready" }>; setModel: (model: Model) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(model.message);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const result = await postAccept(model.token, model.screen.email, password, confirm);
    if (result.ok) return;
    if (result.error === "sign_in_required") {
      window.location.assign(signInHref(model.screen.email));
      return;
    }
    if (isClosedInviteState(result.error)) {
      setModel({ phase: "closed", state: result.error });
      return;
    }
    setMessage(acceptErrorCopy(result.error));
    setBusy(false);
  }
  return <form className="form-stack" data-feature="invite-setup" onSubmit={(event) => void submit(event)}>
    <p className="eyebrow">Invitation</p>
    <h1>Set up your CleanTrack account</h1>
    <p className="muted">{model.screen.businessName} invited you.</p>
    <label>Email<input type="email" value={model.screen.email} readOnly aria-readonly="true" autoComplete="username" /></label>
    <GoogleInviteButton email={model.screen.email} busy={busy} setBusy={setBusy} setMessage={setMessage} />
    <div className="auth-divider"><span>or create a password</span></div>
    <PasswordFields password={password} confirm={confirm} visible={visible} onPassword={setPassword} onConfirm={setConfirm} onVisible={setVisible} />
    {message ? <p className="alert" role="alert">{message}</p> : null}
    <button className="button" disabled={busy}>{busy ? "Creating…" : "Create account and continue"}</button>
  </form>;
}

function PasswordFields({
  password, confirm, visible, onPassword, onConfirm, onVisible,
}: {
  password: string;
  confirm: string;
  visible: boolean;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  onVisible: (value: boolean) => void;
}) {
  const type = visible ? "text" : "password";
  return <>
    <label>Password
      <span className="password-line">
        <input type={type} autoComplete="new-password" required minLength={AUTH_MIN_PASSWORD_LENGTH} maxLength={128} value={password} onChange={(event) => onPassword(event.target.value)} aria-describedby="password-strength" />
        <button type="button" className="password-toggle" aria-pressed={visible} onClick={() => onVisible(!visible)}>{visible ? "Hide" : "Show"}</button>
      </span>
      <small id="password-strength">{passwordStrengthHint(password)}</small>
    </label>
    <label>Confirm password
      <input type={type} autoComplete="new-password" required minLength={AUTH_MIN_PASSWORD_LENGTH} maxLength={128} value={confirm} onChange={(event) => onConfirm(event.target.value)} />
    </label>
  </>;
}

function SignInPrompt({ model }: { model: Extract<Model, { phase: "ready" }> }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  return <div data-feature="invite-sign-in">
    <p className="eyebrow">Invitation</p>
    <h1>Sign in to accept</h1>
    <p className="muted">{model.screen.businessName} invited {model.screen.email}. Sign in with that email, then we will finish the invitation.</p>
    <GoogleInviteButton email={model.screen.email} busy={busy} setBusy={setBusy} setMessage={setMessage} />
    {message ? <p className="alert" role="alert">{message}</p> : null}
    <p className="switch-copy"><a href={signInHref(model.screen.email)}>Sign in</a></p>
  </div>;
}

function GoogleInviteButton({
  email, busy, setBusy, setMessage,
}: Readonly<{
  email: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string) => void;
}>) {
  async function continueWithGoogle() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/invite",
        errorCallbackURL: "/invite",
      });
      if (result.error) setMessage(result.error.status === 429 ? "Too many attempts. Try again shortly." : `Google sign-in is not available for ${email}. Try email instead.`);
    } catch {
      setMessage("Could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return <button data-testid="invite-google" className="button secondary auth-provider" type="button" disabled={busy} onClick={() => void continueWithGoogle()}>
    {busy ? "Opening Google…" : "Continue with Google"}
  </button>;
}

function Mismatch({ model, setModel }: { model: Extract<Model, { phase: "ready" }>; setModel: (model: Model) => void }) {
  const [busy, setBusy] = useState(false);
  return <div data-feature="invite-mismatch">
    <p className="eyebrow">Invitation</p>
    <h1>This invitation is for a different account</h1>
    <p className="muted">You are signed in as {model.screen.signedInEmail}. This invitation is for {model.screen.email}.</p>
    <button className="button" type="button" disabled={busy} onClick={() => void signOut(setModel, setBusy)}>{busy ? "Signing out…" : "Sign out"}</button>
  </div>;
}

function Accepting({ model, setModel }: { model: Extract<Model, { phase: "ready" }>; setModel: (model: Model) => void }) {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void postAccept(model.token, model.screen.email, null, null).then((result) => {
      if (result.ok) return;
      if (isClosedInviteState(result.error)) {
        setModel({ phase: "closed", state: result.error });
        return;
      }
      setModel({ phase: "message", message: acceptErrorCopy(result.error) });
    });
  }, [model, setModel]);
  return <p role="status" data-feature="invite-accepting">Signing you in…</p>;
}

async function signOut(setModel: (model: Model) => void, setBusy: (busy: boolean) => void) {
  setBusy(true);
  await authClient.signOut();
  setModel({ phase: "loading" });
  await loadInvite(setModel);
}

function signInHref(email: string): string {
  return `/sign-in?returnTo=${encodeURIComponent("/invite")}&email=${encodeURIComponent(email)}`;
}

async function loadInvite(setModel: (model: Model) => void) {
  const token = readInviteToken();
  if (!token) {
    setModel({ phase: "closed", state: "unknown" });
    return;
  }
  try {
    const response = await fetch("/api/invitations/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ token }),
    });
    const body: unknown = await response.json().catch(() => null);
    setModel(modelFromScreen(token, inviteScreen(response.status, body)));
  } catch {
    setModel({ phase: "message", message: "Could not check this invitation. Try the link again." });
  }
}

function modelFromScreen(token: string, screen: InviteScreen): Model {
  if (screen.kind === "closed") return { phase: "closed", state: screen.state };
  if (screen.kind === "rate_limited") return { phase: "message", message: acceptErrorCopy("rate_limited") };
  if (screen.kind === "unavailable") return { phase: "message", message: "Could not check this invitation. Try the link again." };
  return { phase: "ready", token, screen, message: "" };
}

async function postAccept(token: string, email: string, password: string | null, passwordConfirm: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  const response = await fetch("/api/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    body: JSON.stringify({ token, email, password, passwordConfirm }),
  });
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (response.ok) {
    clearInviteToken();
    window.location.assign("/portal");
    return { ok: true };
  }
  return { ok: false, error: typeof body?.error === "string" ? body.error : "request_failed" };
}

function readInviteToken(): string {
  const fromHash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (/^[A-Za-z0-9_-]{20,200}$/.test(fromHash)) {
    sessionStorage.setItem(TOKEN_KEY, fromHash);
    return fromHash;
  }
  const stored = sessionStorage.getItem(TOKEN_KEY) ?? "";
  return /^[A-Za-z0-9_-]{20,200}$/.test(stored) ? stored : "";
}

function clearInviteToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}
