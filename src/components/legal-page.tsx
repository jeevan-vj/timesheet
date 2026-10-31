import type { ReactNode } from "react";

export function LegalPage({
  children,
  effectiveDate,
  title,
}: {
  children: ReactNode;
  effectiveDate: string;
  title: string;
}) {
  return (
    <main className="legal-page">
      <nav className="topbar">
        <a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a>
        <div className="nav-actions"><a href="/sign-in">Sign in</a><a className="button small" href="/sign-up">Create account</a></div>
      </nav>
      <article className="legal-card">
        <p className="eyebrow">CleanTrack</p>
        <h1>{title}</h1>
        <p className="legal-effective">Effective {effectiveDate}</p>
        <div className="legal-content">{children}</div>
      </article>
      <footer className="site-footer">
        <span>© 2026 CleanTrack</span>
        <nav aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
      </footer>
    </main>
  );
}
