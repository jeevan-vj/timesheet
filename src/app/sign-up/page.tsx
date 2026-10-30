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

export default function SignUpPage() {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"email" | "google" | null>(null); const [error, setError] = useState("");
  const [returnTo, setReturnTo] = useState("/dashboard");
  useEffect(() => { setReturnTo(returnToFromLocation()); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending("email"); setError("");
    const next = returnToFromLocation();
    try {
      const result = await authClient.signUp.email({ name, email, password, callbackURL: next });
      if (result.error) { setError(result.error.status === 429 ? "Too many attempts. Try again shortly." : "We could not create that account."); return; }
      window.location.assign(next);
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }
  async function signUpWithGoogle() {
    if (pending) return;
    setPending("google"); setError("");
    const next = returnToFromLocation();
    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: next,
        errorCallbackURL: `/sign-up?returnTo=${encodeURIComponent(next)}`,
      });
      if (result.error) setError(result.error.status === 429 ? "Too many attempts. Try again shortly." : "Google account creation is not available. Try email instead.");
    } catch {
      setError("Could not connect. Check your connection and try again.");
    } finally {
      setPending(null);
    }
  }
  return <AuthShell>
    <p className="eyebrow">Get organised</p><h1>Create your owner account</h1><p className="muted">One private workspace for your cleaning sites and contractors.</p>
    <button data-testid="google-sign-up" className="button secondary auth-provider" type="button" disabled={pending !== null} onClick={() => void signUpWithGoogle()}>
      {pending === "google" ? "Opening Google…" : "Continue with Google"}
    </button>
    <div className="auth-divider"><span>or use email</span></div>
    <form className="form-stack" onSubmit={submit}>
      <label>Your name<input autoComplete="name" required disabled={pending !== null} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Email<input type="email" autoComplete="email" required disabled={pending !== null} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" autoComplete="new-password" required disabled={pending !== null} minLength={AUTH_MIN_PASSWORD_LENGTH} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} /><small>Use at least {AUTH_MIN_PASSWORD_LENGTH} characters.</small></label>
      {error ? <p className="alert" role="alert">{error}</p> : null}
      <button className="button" type="submit" disabled={pending !== null}>{pending === "email" ? "Creating…" : "Create account"}</button>
    </form>
    <p className="switch-copy">Already set up? <a href={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</a></p>
  </AuthShell>;
}
