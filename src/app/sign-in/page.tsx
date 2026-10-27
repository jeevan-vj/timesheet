"use client";

import { FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/auth-shell";
import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";
import { authClient } from "@/lib/auth-client";
import { safeReturnTo } from "@/lib/return-to";

function returnToFromLocation(): string {
  if (typeof window === "undefined") return "/dashboard";
  return safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
}

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [returnTo, setReturnTo] = useState("/dashboard");
  useEffect(() => {
    setReturnTo(returnToFromLocation());
    const email = new URLSearchParams(window.location.search).get("email") ?? "";
    if (/^[^\s@]+@[^\s@]+$/.test(email) && email.length <= 254) setEmail(email);
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    const next = returnToFromLocation();
    try {
      const result = await authClient.signIn.email({ email, password });
      if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Try again shortly." : "Email or password was not recognised."); return; }
      window.location.assign(next);
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return <AuthShell>
    <p className="eyebrow">Welcome back</p><h1>Sign in to your workspace</h1><p className="muted">Continue to this week’s hours and payment totals.</p>
    <form className="form-stack" onSubmit={submit}>
      <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="current-password" required minLength={AUTH_MIN_PASSWORD_LENGTH} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="button" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
    <p className="switch-copy">New to CleanTrack? <a href={`/sign-up?returnTo=${encodeURIComponent(returnTo)}`}>Create an account</a></p>
  </AuthShell>;
}
