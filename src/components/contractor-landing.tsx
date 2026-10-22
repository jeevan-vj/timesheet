"use client";

import { authClient } from "@/lib/auth-client";

export function ContractorLanding() {
  return <main className="app-shell contractor-landing">
    <header className="app-header"><a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a><button className="link-button" onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}>Sign out</button></header>
    <section className="dashboard-heading"><div><p className="eyebrow">Contractor account</p><h1>Welcome to CleanTrack</h1><p className="muted">Your account is linked. Contractor timesheets and schedules will arrive in the next portal update.</p></div></section>
  </main>;
}
