"use client";

import {
  formatMinutes,
  formatNzd,
} from "@cleantrack/core";
import {
  directionsUrl,
  formatDayHeading,
  formatShiftTime,
  formatWeekRange,
  portalCalendar,
  portalPaymentDetailSchema,
  portalPaymentsSchema,
  portalUpcomingSchema,
  shiftStatusLabel,
  type PortalPaymentDetail,
  type PortalPayments,
  type PortalUpcoming,
} from "@cleantrack/core/portal";
import { useEffect, useState } from "react";
import { RoleSwitcher } from "@/components/role-switcher";
import { authClient } from "@/lib/auth-client";
import { asViewerShape, type ViewerShape } from "@/lib/viewer-path";

type PortalData = { upcoming: PortalUpcoming; payments: PortalPayments };

export function PortalHome() {
  const [viewer, setViewer] = useState<ViewerShape | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [detail, setDetail] = useState<PortalPaymentDetail | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPortal().then((loaded) => {
      if (cancelled || !loaded) return;
      setViewer(loaded.viewer);
      setData(loaded.data);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => { cancelled = true; };
  }, []);

  async function openRemittance(weekStart: string) {
    setDetail(null);
    setDetailFailed(false);
    try {
      const response = await fetch(`/api/portal/payments/${weekStart}`, { cache: "no-store" });
      if (!response.ok) throw new Error("payment_unavailable");
      setDetail(portalPaymentDetailSchema.parse(await response.json()));
    } catch {
      setDetailFailed(true);
    }
  }

  return <main className="app-shell" data-feature="contractor-portal">
    <header className="app-header">
      <a className="brand" href="/"><span className="brand-mark">C</span> CleanTrack</a>
      <nav><button className="link-button" onClick={() => void authClient.signOut().then(() => window.location.assign("/"))}>Sign out</button></nav>
    </header>
    <section className="dashboard-heading">
      <div>
        <p className="eyebrow">Contractor portal</p>
        <h1>My work</h1>
        <p className="muted">See your assigned work and approved remittance details.</p>
      </div>
    </section>
    {failed ? <p className="alert" role="alert">Could not open the portal. Try again from the sign-in page.</p> : null}
    {viewer && data ? <PortalBody data={data} detail={detail} detailFailed={detailFailed} onOpenRemittance={openRemittance} viewer={viewer} /> : failed ? null : <section className="loading-card" role="status">Loading your work…</section>}
  </main>;
}

async function loadPortal(): Promise<{ viewer: ViewerShape; data: PortalData } | null> {
  const response = await fetch("/api/me", { cache: "no-store" });
  if (response.status === 401) {
    window.location.assign("/sign-in?returnTo=%2Fportal");
    return null;
  }
  if (!response.ok) throw new Error("viewer_unavailable");
  const viewer = asViewerShape(await response.json());
  const { weekStart } = portalCalendar();
  const [upcomingResponse, paymentsResponse] = await Promise.all([
    fetch("/api/portal/upcoming?days=14", { cache: "no-store" }),
    fetch(`/api/portal/payments?week=${weekStart}`, { cache: "no-store" }),
  ]);
  if (!upcomingResponse.ok || !paymentsResponse.ok) throw new Error("portal_unavailable");
  return {
    viewer,
    data: {
      upcoming: portalUpcomingSchema.parse(await upcomingResponse.json()),
      payments: portalPaymentsSchema.parse(await paymentsResponse.json()),
    },
  };
}

function PortalBody({
  viewer, data, detail, detailFailed, onOpenRemittance,
}: {
  viewer: ViewerShape;
  data: PortalData;
  detail: PortalPaymentDetail | null;
  detailFailed: boolean;
  onOpenRemittance: (weekStart: string) => Promise<void>;
}) {
  const shifts = data.upcoming.days.flatMap((day) => day.shifts);
  return <>
    <RoleSwitcher viewer={viewer} current="portal" />
    {viewer.contractorOf.length === 0 ? <p className="muted">No contractor portal is linked to this account. <a href="/dashboard">Owner workspace</a></p> : <div className="portal-grid">
      <p className="muted portal-workspaces">My work at {viewer.contractorOf.map((link) => link.businessName).join(", ")}</p>
      <section className="panel portal-section" aria-labelledby="assigned-work-heading">
        <div><p className="eyebrow">Next 14 days</p><h2 id="assigned-work-heading">Assigned work</h2></div>
        {shifts.length === 0 ? <p className="muted">Nothing is assigned yet.</p> : data.upcoming.days.map((day) => <div className="portal-day" key={day.date}>
          <h3>{formatDayHeading(day.date)}</h3>
          {day.shifts.map((shift) => {
            const directions = directionsUrl(shift.address, "web");
            return <article className="portal-row" key={`${shift.businessId}:${shift.id}`}>
              <div><strong>{shift.siteName}</strong><span>{shift.businessName} · {formatShiftTime(shift)} · {shiftStatusLabel(shift.occurrenceKind)}</span>{shift.address ? <span>{shift.address}</span> : null}</div>
              {directions ? <a href={directions} rel="noreferrer" target="_blank">Directions</a> : null}
            </article>;
          })}
        </div>)}
      </section>
      <section className="panel portal-section" aria-labelledby="remittance-heading">
        <div><p className="eyebrow">Approved pay</p><h2 id="remittance-heading">Remittance</h2></div>
        <div className="portal-summary"><span>This week</span><strong>{formatNzd(data.payments.headline.payCents)}</strong><span>{formatMinutes(data.payments.headline.paidMinutes)}{data.payments.headline.estimated ? " · estimated" : " · approved"}</span></div>
        {data.payments.weeks.length === 0 ? <p className="muted">Approved remittance details will appear after the business approves a week.</p> : <div className="portal-remittances">
          {data.payments.weeks.map((week) => <button className="portal-row portal-row-button" key={week.weekStart} onClick={() => void onOpenRemittance(week.weekStart)}>
            <span><strong>{formatWeekRange(week.weekStart, week.weekEnd)}</strong><span>{formatMinutes(week.paidMinutes)}</span></span><strong>{formatNzd(week.payCents)}</strong>
          </button>)}
        </div>}
        {detailFailed ? <p className="alert" role="alert">Could not open that remittance. Try again.</p> : null}
        {detail ? <div className="portal-detail" aria-live="polite">
          <h3>{formatWeekRange(detail.weekStart, detail.weekEnd)}</h3>
          <p><strong>{formatNzd(detail.payCents)}</strong> · {formatMinutes(detail.paidMinutes)}</p>
          {detail.lines.map((line) => <div className="portal-detail-line" key={line.id}><span>{formatDayHeading(line.workDate)} · {line.siteName}<small>{line.businessName} · {formatMinutes(line.paidMinutes)}</small></span><strong>{formatNzd(line.payCents)}</strong></div>)}
        </div> : null}
      </section>
    </div>}
  </>;
}
