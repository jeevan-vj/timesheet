"use client";

import { useEffect, useState } from "react";
import { RoleSwitcher } from "@/components/role-switcher";
import { authClient } from "@/lib/auth-client";
import { asViewerShape, type ViewerShape } from "@/lib/viewer-path";

export function PortalHome() {
  const [viewer, setViewer] = useState<ViewerShape | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/me", { cache: "no-store" }).then(async (response) => {
      if (cancelled) return;
      if (response.status === 401) {
        window.location.assign("/sign-in?returnTo=%2Fportal");
        return;
      }
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setViewer(asViewerShape(await response.json()));
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, []);

  return <main className="app-shell" data-feature="contractor-portal">
    <header className="app-header">
      <a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a>
      <nav><button className="link-button" onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}>Sign out</button></nav>
    </header>
    <section className="dashboard-heading">
      <div>
        <p className="eyebrow">Contractor portal</p>
        <h1>My work</h1>
        <p className="muted">Your week, sites, and payments are not available yet. This page does not show hours, rates, or pay.</p>
      </div>
    </section>
    {failed ? <p className="alert" role="alert">Could not open the portal. Try again from the sign-in page.</p> : null}
    {viewer ? <PortalBody viewer={viewer} /> : failed ? null : <section className="loading-card" role="status">Loading your work…</section>}
  </main>;
}

function PortalBody({ viewer }: { viewer: ViewerShape }) {
  return <>
    <RoleSwitcher viewer={viewer} current="portal" />
    {viewer.contractorOf.length === 0 ? <p className="muted">No contractor portal is linked to this account. <a href="/dashboard">Owner workspace</a></p> : <ul className="portal-links">
      {viewer.contractorOf.map((link) => <li key={link.businessId}>My work at {link.businessName}</li>)}
    </ul>}
  </>;
}
