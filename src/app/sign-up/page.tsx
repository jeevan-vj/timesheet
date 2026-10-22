"use client";

import { FormEvent, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await authClient.signUp.email({ name, email, password, callbackURL: "/dashboard" });
      if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Try again shortly." : "We could not create that account."); return; }
      window.location.assign("/dashboard");
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return <AuthShell>
    <p className="eyebrow">Get organised</p><h1>Create your owner account</h1><p className="muted">One private workspace for your cleaning sites and contractors.</p>
    <form className="form-stack" onSubmit={submit}>
      <label>Your name<input autoComplete="name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="new-password" required minLength={AUTH_MIN_PASSWORD_LENGTH} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /><small>Use at least {AUTH_MIN_PASSWORD_LENGTH} characters.</small></label>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="button" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
    </form>
    <p className="switch-copy">Already set up? <a href="/sign-in">Sign in</a></p>
  </AuthShell>;
}
