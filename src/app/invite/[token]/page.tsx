"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";
import { authClient } from "@/lib/auth-client";

type InviteView = { invitedEmail: string; businessName: string; expiresAt: string };
type Mode = "loading" | "unavailable" | "auth" | "accept" | "accepted";

function currentToken(): string { return decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) ?? ""); }

export default function InvitePage() {
  const [mode, setMode] = useState<Mode>("loading");
  const [invite, setInvite] = useState<InviteView | null>(null);
  const [authMode, setAuthMode] = useState<"signup" | "signin">("signup");
  const [name, setName] = useState(""); const [password, setPassword] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch(`/api/invites/${encodeURIComponent(currentToken())}`, { cache: "no-store" }).then(async (response) => {
      if (!response.ok) { setMode("unavailable"); return; }
      setInvite(await response.json() as InviteView);
      const role = await fetch("/api/account/role", { cache: "no-store" });
      setMode(role.ok ? "accept" : "auth");
    }).catch(() => setMode("unavailable"));
  }, []);

  async function accept() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/invites/${encodeURIComponent(currentToken())}`, { method: "POST" });
      if (!response.ok) { setError("This invitation cannot be accepted with this account."); return; }
      setMode("accepted");
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  async function authenticate(event: FormEvent) {
    event.preventDefault(); if (!invite) return;
    setBusy(true); setError("");
    try {
      if (authMode === "signup") {
        const response = await fetch(`/api/invites/${encodeURIComponent(currentToken())}/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, password }),
        });
        if (!response.ok) { setError("We could not create that account."); return; }
      } else {
        const result = await authClient.signIn.email({ email: invite.invitedEmail, password });
        if (result.error) { setError("Email or password was not recognised."); return; }
      }
      setMode("accept");
      await accept();
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { setBusy(false); }
  }

  if (mode === "loading") return <AuthShell><p role="status">Loading invitation…</p></AuthShell>;
  if (mode === "unavailable") return <AuthShell><p className="eyebrow">Invitation unavailable</p><h1>This invitation can’t be used</h1><p className="muted">It may have expired, been revoked, or already been accepted. Ask the business owner for a new invitation.</p></AuthShell>;
  if (!invite) return null;
  if (mode === "accepted") return <AuthShell><h1>Invitation accepted</h1><p>Your account is now linked to the existing contractor record.</p><a className="button" href="/contractor">Continue to contractor account</a></AuthShell>;
  if (mode === "accept") return <AuthShell><p className="eyebrow">{invite.businessName}</p><h1>Accept your invitation</h1><p className="muted">Continue with the signed-in account for {invite.invitedEmail}.</p>{error ? <p className="alert" role="alert">{error}</p> : null}<button className="button" disabled={busy} onClick={() => void accept()}>{busy ? "Accepting…" : "Accept invitation"}</button></AuthShell>;
  return <AuthShell>
    <p className="eyebrow">{invite.businessName}</p><h1>{authMode === "signup" ? "Create your contractor account" : "Sign in to accept"}</h1>
    <p className="muted">This invitation is locked to {invite.invitedEmail}.</p>
    <form className="form-stack" onSubmit={authenticate}>
      {authMode === "signup" ? <label>Your name<input required maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} /></label> : null}
      <label>Email<input type="email" readOnly aria-readonly="true" value={invite.invitedEmail} /></label>
      <label>Password<input type="password" required minLength={AUTH_MIN_PASSWORD_LENGTH} maxLength={128} autoComplete={authMode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="button" disabled={busy}>{busy ? "Please wait…" : authMode === "signup" ? "Create account and accept" : "Sign in and accept"}</button>
    </form>
    <button type="button" className="link-button invite-auth-switch" onClick={() => { setAuthMode(authMode === "signup" ? "signin" : "signup"); setError(""); }}>{authMode === "signup" ? "Already have an account? Sign in" : "Need an account? Sign up"}</button>
  </AuthShell>;
}
