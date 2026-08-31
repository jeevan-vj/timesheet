import type { ReactNode } from "react";

export function AuthShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <main className="auth-page">
      <a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a>
      <section className="auth-card">{children}</section>
      <p className="micro">Your contractor and payment data stays inside your private workspace.</p>
    </main>
  );
}
