import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPortalSqlite, portalDatabase } from "./portal-db";
import { seedOwnerWorkspace } from "./owner-workspace";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
  lookups: 0,
}));

const handle = vi.hoisted(() => ({ database: null as unknown }));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    AI: {},
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
    RELEASE_SHA: "test",
    EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>",
  },
}));
vi.mock("@/db/client", () => ({
  db: new Proxy({}, {
    get(_target, prop) {
      const database = handle.database as Record<PropertyKey, unknown> | null;
      if (!database) throw new Error("database unavailable");
      const value = database[prop];
      return typeof value === "function" ? value.bind(database) : value;
    },
  }),
}));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async (request: Request) => {
    session.lookups += 1;
    return request.headers.has("cookie") ? session.user : null;
  },
}));

import { POST as restoreAssignment } from "../src/app/api/assignments/[id]/restore/route";
import { DELETE as deleteAssignment, GET as getAssignment, PATCH as patchAssignment } from "../src/app/api/assignments/[id]/route";
import { DELETE as deleteSchedule, GET as getSchedule, PUT as putSchedule } from "../src/app/api/assignments/[id]/schedule/route";
import { GET as getAssignments, POST as postAssignment } from "../src/app/api/assignments/route";
import { DELETE as deleteHoliday } from "../src/app/api/business/holidays/[id]/route";
import { GET as getHolidays, POST as postHoliday } from "../src/app/api/business/holidays/route";
import { POST as completeOnboarding } from "../src/app/api/business/onboarding/complete/route";
import { GET as getPayRules, PUT as putPayRules } from "../src/app/api/business/pay-rules/route";
import { POST as postBusiness } from "../src/app/api/business/route";
import { POST as archiveContractor } from "../src/app/api/contractors/[id]/archive/route";
import { POST as resendInvitation } from "../src/app/api/contractors/[id]/invitation/resend/route";
import { POST as revokeInvitation } from "../src/app/api/contractors/[id]/invitation/revoke/route";
import { GET as getInvitation, POST as postInvitation } from "../src/app/api/contractors/[id]/invitation/route";
import { GET as getRemittance } from "../src/app/api/contractors/[id]/remittance/route";
import { POST as restoreContractor } from "../src/app/api/contractors/[id]/restore/route";
import { GET as getContractor, PATCH as patchContractor } from "../src/app/api/contractors/[id]/route";
import { GET as getContractors, POST as postContractor } from "../src/app/api/contractors/route";
import { GET as getDashboard } from "../src/app/api/dashboard/route";
import { GET as getMe } from "../src/app/api/me/route";
import { POST as confirmAssistant } from "../src/app/api/owner-assistant/confirm/route";
import { POST as turnAssistant } from "../src/app/api/owner-assistant/turn/route";
import { GET as getPortalRemittance } from "../src/app/api/portal/payments/[week]/remittance/[business]/route";
import { GET as getPortalPayment } from "../src/app/api/portal/payments/[week]/route";
import { GET as getPortalPayments } from "../src/app/api/portal/payments/route";
import { GET as getPortalUpcoming } from "../src/app/api/portal/upcoming/route";
import { GET as getPortalWeek } from "../src/app/api/portal/week/route";
import { POST as restoreSite } from "../src/app/api/sites/[id]/restore/route";
import { DELETE as deleteSite, GET as getSite, PATCH as patchSite } from "../src/app/api/sites/[id]/route";
import { GET as getSites, POST as postSite } from "../src/app/api/sites/route";
import { POST as postException } from "../src/app/api/time-entries/[id]/exception/route";
import { DELETE as deleteEntry, GET as getEntry, PATCH as patchEntry } from "../src/app/api/time-entries/[id]/route";
import { POST as postEntry } from "../src/app/api/time-entries/route";
import { POST as applySchedule } from "../src/app/api/weeks/apply-schedule/route";
import { POST as approveWeek } from "../src/app/api/weeks/approve/route";
import { POST as reopenWeek } from "../src/app/api/weeks/reopen/route";

type RouteCase = {
  method: string;
  path: string;
  invoke: (request: Request) => Promise<Response>;
  body?: unknown;
};

const idContext = { params: Promise.resolve({ id: "missing" }) };
const ownerRoutes: RouteCase[] = [
  { method: "POST", path: "/api/assignments/missing/restore", invoke: (request) => restoreAssignment(request, idContext) },
  { method: "GET", path: "/api/assignments/missing", invoke: (request) => getAssignment(request, idContext) },
  { method: "PATCH", path: "/api/assignments/missing", body: {}, invoke: (request) => patchAssignment(request, idContext) },
  { method: "DELETE", path: "/api/assignments/missing", invoke: (request) => deleteAssignment(request, idContext) },
  { method: "GET", path: "/api/assignments/missing/schedule", invoke: (request) => getSchedule(request, idContext) },
  { method: "PUT", path: "/api/assignments/missing/schedule", body: {}, invoke: (request) => putSchedule(request, idContext) },
  { method: "DELETE", path: "/api/assignments/missing/schedule", body: {}, invoke: (request) => deleteSchedule(request, idContext) },
  { method: "GET", path: "/api/assignments", invoke: getAssignments },
  { method: "POST", path: "/api/assignments", body: {}, invoke: postAssignment },
  { method: "POST", path: "/api/business", body: {}, invoke: postBusiness },
  { method: "POST", path: "/api/business/onboarding/complete", invoke: completeOnboarding },
  { method: "GET", path: "/api/business/pay-rules", invoke: getPayRules },
  { method: "PUT", path: "/api/business/pay-rules", body: {}, invoke: putPayRules },
  { method: "GET", path: "/api/business/holidays", invoke: getHolidays },
  { method: "POST", path: "/api/business/holidays", body: {}, invoke: postHoliday },
  { method: "DELETE", path: "/api/business/holidays/missing", invoke: (request) => deleteHoliday(request, idContext) },
  { method: "POST", path: "/api/contractors/missing/archive", invoke: (request) => archiveContractor(request, idContext) },
  { method: "POST", path: "/api/contractors/missing/invitation/resend", invoke: (request) => resendInvitation(request, idContext) },
  { method: "POST", path: "/api/contractors/missing/invitation/revoke", invoke: (request) => revokeInvitation(request, idContext) },
  { method: "GET", path: "/api/contractors/missing/invitation", invoke: (request) => getInvitation(request, idContext) },
  { method: "POST", path: "/api/contractors/missing/invitation", invoke: (request) => postInvitation(request, idContext) },
  { method: "GET", path: "/api/contractors/missing/remittance?week=bad", invoke: (request) => getRemittance(request, idContext) },
  { method: "POST", path: "/api/contractors/missing/restore", invoke: (request) => restoreContractor(request, idContext) },
  { method: "GET", path: "/api/contractors/missing", invoke: (request) => getContractor(request, idContext) },
  { method: "PATCH", path: "/api/contractors/missing", body: {}, invoke: (request) => patchContractor(request, idContext) },
  { method: "GET", path: "/api/contractors", invoke: getContractors },
  { method: "POST", path: "/api/contractors", body: {}, invoke: postContractor },
  { method: "GET", path: "/api/dashboard?week=2026-10-19", invoke: getDashboard },
  { method: "POST", path: "/api/owner-assistant/confirm", body: {}, invoke: confirmAssistant },
  { method: "POST", path: "/api/owner-assistant/turn", body: {}, invoke: turnAssistant },
  { method: "POST", path: "/api/sites/missing/restore", invoke: (request) => restoreSite(request, idContext) },
  { method: "GET", path: "/api/sites/missing", invoke: (request) => getSite(request, idContext) },
  { method: "PATCH", path: "/api/sites/missing", body: {}, invoke: (request) => patchSite(request, idContext) },
  { method: "DELETE", path: "/api/sites/missing", invoke: (request) => deleteSite(request, idContext) },
  { method: "GET", path: "/api/sites", invoke: getSites },
  { method: "POST", path: "/api/sites", body: {}, invoke: postSite },
  { method: "POST", path: "/api/time-entries/missing/exception", body: {}, invoke: (request) => postException(request, idContext) },
  { method: "GET", path: "/api/time-entries/missing", invoke: (request) => getEntry(request, idContext) },
  { method: "PATCH", path: "/api/time-entries/missing", body: {}, invoke: (request) => patchEntry(request, idContext) },
  { method: "DELETE", path: "/api/time-entries/missing", invoke: (request) => deleteEntry(request, idContext) },
  { method: "POST", path: "/api/time-entries", body: {}, invoke: postEntry },
  { method: "POST", path: "/api/weeks/apply-schedule", body: {}, invoke: applySchedule },
  { method: "POST", path: "/api/weeks/approve", body: {}, invoke: approveWeek },
  { method: "POST", path: "/api/weeks/reopen", body: {}, invoke: reopenWeek },
];

const activeOwnerOnlyRoutes = ownerRoutes.filter((route) => route.path.startsWith("/api/business/pay-rules") || route.path.startsWith("/api/business/holidays"));

const portalRoutes: RouteCase[] = [
  { method: "GET", path: "/api/portal/week?week=2026-10-19", invoke: getPortalWeek },
  { method: "GET", path: "/api/portal/upcoming?days=14", invoke: getPortalUpcoming },
  { method: "GET", path: "/api/portal/payments?week=2026-10-19", invoke: getPortalPayments },
  {
    method: "GET",
    path: "/api/portal/payments/2026-10-19",
    invoke: (request) => getPortalPayment(request, { params: Promise.resolve({ week: "2026-10-19" }) }),
  },
  {
    method: "GET",
    path: "/api/portal/payments/2026-10-19/remittance/biz_owner-a",
    invoke: (request) => getPortalRemittance(request, {
      params: Promise.resolve({ week: "2026-10-19", business: "biz_owner-a" }),
    }),
  },
];

function requestFor(route: RouteCase, authenticated: boolean): Request {
  const headers = new Headers();
  if (authenticated) {
    headers.set("cookie", "better-auth.session_token=test");
    headers.set("origin", "https://app.example.test");
  }
  const init: RequestInit = { method: route.method, headers };
  if (route.body !== undefined) {
    const body = JSON.stringify(route.body);
    headers.set("content-type", "application/json");
    headers.set("content-length", String(body.length));
    init.body = body;
  }
  return new Request(`https://app.example.test${route.path}`, init);
}

function seedContractorSession(sqlite: SqlJsDatabase) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('contractor-user', 'Contractor', 'contractor@example.test', 1, 1700000000, 1700000000)",
  );
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone,
      default_rate_cents, currency, active, engagement_status
    ) VALUES ('contractor-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000,
      'Contractor', 'contractor@example.test', '', 3200, 'NZD', 1, 'active')`,
  );
  sqlite.run(
    `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
     VALUES ('site-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Site A', '', 1)`,
  );
  sqlite.run(
    `INSERT INTO assignment (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, rate_cents, active)
     VALUES ('assignment-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'contractor-a', 'site-a', NULL, 1)`,
  );
  sqlite.run(
    `INSERT INTO time_entry (
      id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
      start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind
    ) VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000,
      'contractor-a', 'site-a', '2026-10-20', 540, 600, 0, 60, 3200, '', 'clock', 'worked')`,
  );
  sqlite.run(
    `INSERT INTO week_approval (
      id, owner_user_id, business_id, created_at, updated_at, week_start, status, approved_at, reopened_at
    ) VALUES ('approval-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000,
      '2026-10-19', 'approved', 1700000000, NULL)`,
  );
  sqlite.run(
    `INSERT INTO contractor_account (
      id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
    ) VALUES ('account-a', 'biz_owner-a', 'owner-a', 'contractor-a', 'contractor-user', 1, 1700000000, 1700000000)`,
  );
}

const CROSS_ORIGIN = "https://smoke.invalid";
const mutatingOwnerRoutes = ownerRoutes.filter((route) => route.method !== "GET");
const readOwnerRoutes = ownerRoutes.filter((route) => route.method === "GET");

function requestWith(route: RouteCase, headers: Record<string, string>): Request {
  const init: RequestInit = { method: route.method, headers: new Headers(headers) };
  if (route.body !== undefined) {
    const body = JSON.stringify(route.body);
    (init.headers as Headers).set("content-type", "application/json");
    (init.headers as Headers).set("content-length", String(body.length));
    init.body = body;
  }
  return new Request(`https://app.example.test${route.path}`, init);
}

function cookieMutation(origin: string): Request {
  const body = "{}";
  return new Request("https://app.example.test/api/sites", {
    method: "POST",
    body,
    headers: {
      cookie: "cleantrack-smoke=1",
      origin,
      "content-type": "application/json",
      "content-length": String(body.length),
    },
  });
}

describe("owner-only API boundary", () => {
  beforeEach(async () => {
    session.lookups = 0;
    const sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Owner A", email: "owner@example.test" });
    seedContractorSession(sqlite);
  });

  it.each(ownerRoutes)("returns 401 without a session for $method $path", async (route) => {
    session.user = null;
    const response = await route.invoke(requestFor(route, false));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it.each(ownerRoutes)("returns 403 to a contractor for $method $path", async (route) => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const response = await route.invoke(requestFor(route, true));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each(ownerRoutes)("lets an owner pass the auth layer for $method $path", async (route) => {
    session.user = { id: "owner-a", email: "owner@example.test", name: "Owner A" };
    const response = await route.invoke(requestFor(route, true));
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it("keeps the empty dashboard available to a signed-in user with no business or contractor link", async () => {
    session.user = { id: "new-owner", email: "new-owner@example.test", name: "New Owner" };
    const response = await getDashboard(new Request("https://app.example.test/api/dashboard?week=2026-10-19", {
      headers: { cookie: "better-auth.session_token=test" },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ business: null, entries: [] });
  });

  it.each(portalRoutes)("keeps contractor portal access at 2xx for $method $path", async (route) => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const response = await route.invoke(requestFor(route, true));
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });

  it.each(activeOwnerOnlyRoutes)("returns 403 to a signed-in user with no owner workspace for $method $path", async (route) => {
    session.user = { id: "new-owner", email: "new-owner@example.test", name: "New Owner" };
    const response = await route.invoke(requestFor(route, true));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("lets a contractor download the approved week remittance PDF from the portal", async () => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const route = portalRoutes.find((item) => item.path.includes("/remittance/"));
    if (!route) throw new Error("portal remittance route missing");
    const response = await route.invoke(requestFor(route, true));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=".+\.pdf"$/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("returns 403 for a forged-origin mutation with a cookie and no session before looking up the session", async () => {
    session.user = null;
    const response = await postSite(cookieMutation("https://smoke.invalid"));
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(session.lookups).toBe(0);
  });

  it("returns 401 for a trusted-origin mutation with a cookie and no session", async () => {
    session.user = null;
    const response = await postSite(cookieMutation("https://app.example.test"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(session.lookups).toBe(1);
  });

  it("keeps the shared viewer route available to a contractor session", async () => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const response = await getMe(requestFor({ method: "GET", path: "/api/me", invoke: getMe }, true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ owner: null });
  });
});

describe("mutation origin check runs before session and owner checks (#143)", () => {
  beforeEach(async () => {
    const sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Owner A", email: "owner@example.test" });
    seedContractorSession(sqlite);
  });

  it("matches the production smoke: unauthenticated cross-origin POST /api/sites returns 403", async () => {
    session.user = null;
    const route = mutatingOwnerRoutes.find((candidate) => candidate.method === "POST" && candidate.path === "/api/sites");
    expect(route).toBeDefined();
    const response = await route!.invoke(requestWith(route!, { origin: CROSS_ORIGIN, cookie: "cleantrack-smoke=1" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each(mutatingOwnerRoutes)("returns 403 to an unauthenticated cross-origin $method $path", async (route) => {
    session.user = null;
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "cleantrack-smoke=1" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each(mutatingOwnerRoutes)("returns 403 to a contractor cross-origin $method $path", async (route) => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "better-auth.session_token=test" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each(mutatingOwnerRoutes)("returns 403 to an owner cross-origin $method $path", async (route) => {
    session.user = { id: "owner-a", email: "owner@example.test", name: "Owner A" };
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "better-auth.session_token=test" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it.each(mutatingOwnerRoutes)("returns 401 to a same-origin $method $path with a cookie but no session", async (route) => {
    session.user = null;
    const response = await route.invoke(requestWith(route, { origin: "https://app.example.test", cookie: "better-auth.session_token=stale" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("lets a same-origin owner create a site (2xx)", async () => {
    session.user = { id: "owner-a", email: "owner@example.test", name: "Owner A" };
    const route = mutatingOwnerRoutes.find((candidate) => candidate.method === "POST" && candidate.path === "/api/sites")!;
    const valid = { ...route, body: { name: "Origin Order Site", address: "" } };
    const response = await route.invoke(requestWith(valid, { origin: "https://app.example.test", cookie: "better-auth.session_token=test" }));
    expect(response.status).toBe(201);
  });

  it.each(readOwnerRoutes)("does not origin-check reads: unauthenticated cross-origin $method $path stays 401", async (route) => {
    session.user = null;
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "cleantrack-smoke=1" }));
    expect(response.status).toBe(401);
  });

  it.each(readOwnerRoutes)("does not origin-check reads: owner cross-origin $method $path passes the auth layer", async (route) => {
    session.user = { id: "owner-a", email: "owner@example.test", name: "Owner A" };
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "better-auth.session_token=test" }));
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it.each(portalRoutes)("leaves portal reads unchanged for a cross-origin contractor $method $path", async (route) => {
    session.user = { id: "contractor-user", email: "contractor@example.test", name: "Contractor" };
    const response = await route.invoke(requestWith(route, { origin: CROSS_ORIGIN, cookie: "better-auth.session_token=test" }));
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
  });
});
