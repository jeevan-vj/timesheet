import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { businessIdForUser, membershipIdForUser } from "../src/lib/business";
import { execContractorEngagementMigration, execContractorInviteMigration, seedOwnerWorkspace } from "./owner-workspace";
import { summarizeWeek, weekEnd } from "../src/lib/payroll";
import { toDashboardApproval } from "../src/services/week-approval";

const session = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.test", name: "Owner One" } as { id: string; email: string; name: string } | null,
}));

const handle = vi.hoisted(() => ({
  database: null as unknown,
  sqlite: null as SqlJsDatabase | null,
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
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
  requireSessionUser: async () => session.user,
}));
vi.mock("@/lib/runtime-env", () => ({
  getTrustedOrigins: () => ["https://app.example.test"],
  getSecureCookies: () => true,
}));

import { POST as createBusiness } from "../src/app/api/business/route";
import { POST as completeOnboarding } from "../src/app/api/business/onboarding/complete/route";
import { GET as listAssignments } from "../src/app/api/assignments/route";
import { GET as listContractors } from "../src/app/api/contractors/route";
import { GET as getDashboard } from "../src/app/api/dashboard/route";
import { POST as createSite, GET as listSites } from "../src/app/api/sites/route";
import { GET as getSite, PATCH as patchSite } from "../src/app/api/sites/[id]/route";
import { POST as approveWeek } from "../src/app/api/weeks/approve/route";

const ORIGIN = "https://app.example.test";
const WEEK = "2026-08-31";

const validProfile = {
  name: "  Northwind Cleaning  ",
  nzbn: "9429000000000",
  address: " 1 Quay St ",
  contactEmail: "office@example.test",
  contactPhone: " 09 000 0000 ",
  timezone: "Pacific/Auckland",
  currency: "NZD",
  weekStart: "monday",
  businessId: "biz_forged",
  ownerUserId: "user_forged",
};

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  const encoded = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    body: encoded,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(encoded)),
      cookie: "better-auth.session_token=test",
      origin: ORIGIN,
      ...headers,
    },
  });
}

function cookieRequest(url: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: "better-auth.session_token=test",
      origin: ORIGIN,
      ...headers,
    },
  });
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
    [id, id, `${id}@example.test`],
  );
}

function count(sqlite: SqlJsDatabase, table: string) {
  return Number(sqlite.exec(`SELECT COUNT(*) FROM ${table}`)[0]?.values[0]?.[0] ?? 0);
}

function column(sqlite: SqlJsDatabase, sql: string) {
  return sqlite.exec(sql)[0]?.values ?? [];
}

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0004_business_workspace.sql"), "utf8"));
  execContractorEngagementMigration(sqlite);
  execContractorInviteMigration(sqlite);
  handle.sqlite = sqlite;
  handle.database = drizzle(sqlite);
  return sqlite;
}

describe("business workspace API", () => {
  beforeEach(async () => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner One" };
    await openMemoryDb();
  });

  it("persists a trimmed profile, ignores forged ids, and rejects invalid workspace fields", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    const created = await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile));
    expect(created.status).toBe(201);
    const body = await created.json() as Record<string, unknown>;
    expect(body).toEqual({
      id: businessIdForUser("owner-1"),
      name: "Northwind Cleaning",
      nzbn: "9429000000000",
      address: "1 Quay St",
      contactEmail: "office@example.test",
      contactPhone: "09 000 0000",
      timezone: "Pacific/Auckland",
      currency: "NZD",
      weekStart: "monday",
      onboardingCompletedAt: null,
    });
    expect(body).not.toHaveProperty("ownerUserId");
    expect(column(sqlite, "SELECT id FROM business")).toEqual([["biz_owner-1"]]);
    expect(column(sqlite, "SELECT id, business_id, user_id, role, active FROM business_member")).toEqual([
      [membershipIdForUser("owner-1"), "biz_owner-1", "owner-1", "owner", 1],
    ]);

    const omitted = {
      name: "Harbour",
      contactEmail: "harbour@example.test",
      timezone: "Pacific/Auckland",
      currency: "NZD",
      weekStart: "monday",
    };
    session.user = { id: "owner-2", email: "two@example.test", name: "Owner Two" };
    insertUser(sqlite, "owner-2");
    const sparse = await createBusiness(jsonRequest("https://app.example.test/api/business", omitted));
    expect(sparse.status).toBe(201);
    expect(await sparse.json()).toMatchObject({
      id: "biz_owner-2",
      nzbn: "",
      address: "",
      contactPhone: "",
    });

    session.user = { id: "owner-3", email: "three@example.test", name: "Owner Three" };
    insertUser(sqlite, "owner-3");
    const cases = [
      { ...omitted, nzbn: "12345" },
      { ...omitted, timezone: "UTC" },
      { ...omitted, currency: "USD" },
      { ...omitted, weekStart: "sunday" },
      { ...omitted, contactEmail: "not-an-email" },
    ];
    for (const input of cases) {
      const response = await createBusiness(jsonRequest("https://app.example.test/api/business", input));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    expect(column(sqlite, "SELECT id FROM business WHERE id = 'biz_owner-3'")).toEqual([]);
    expect(column(sqlite, "SELECT id FROM business WHERE id = 'biz_forged'")).toEqual([]);
  });

  it("returns the stored business on a second POST without overwriting it", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    const first = await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile));
    expect(first.status).toBe(201);
    const second = await createBusiness(jsonRequest("https://app.example.test/api/business", {
      ...validProfile,
      name: "Replacement Cleaning",
      contactEmail: "other@example.test",
      nzbn: "1111111111111",
    }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      id: "biz_owner-1",
      name: "Northwind Cleaning",
      contactEmail: "office@example.test",
      nzbn: "9429000000000",
    });
    expect(count(sqlite, "business")).toBe(1);
    expect(count(sqlite, "business_member")).toBe(1);
  });

  it("repairs a missing membership without changing the stored profile", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    sqlite.run(
      `INSERT INTO business (
        id, name, nzbn, address, contact_email, contact_phone, timezone, currency, week_start,
        onboarding_completed_at, created_at, updated_at
      ) VALUES ('biz_owner-1', 'Original Name', '9429000000001', 'Old St', 'original@example.test', '111', 'Pacific/Auckland', 'NZD', 'monday', NULL, 1700000000, 1700000000)`,
    );
    const response = await createBusiness(jsonRequest("https://app.example.test/api/business", {
      ...validProfile,
      name: "Different Name",
      contactEmail: "different@example.test",
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      id: "biz_owner-1",
      name: "Original Name",
      nzbn: "9429000000001",
      address: "Old St",
      contactEmail: "original@example.test",
      contactPhone: "111",
      onboardingCompletedAt: null,
    });
    expect(column(sqlite, "SELECT id, business_id, user_id, role, active FROM business_member")).toEqual([
      ["mem_owner-1", "biz_owner-1", "owner-1", "owner", 1],
    ]);
    expect(column(sqlite, "SELECT name, contact_email, updated_at FROM business")).toEqual([
      ["Original Name", "original@example.test", 1700000000],
    ]);
  });

  it("returns empty collections and an empty dashboard when the session has no membership", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    const sites = await listSites(cookieRequest("https://app.example.test/api/sites"));
    const contractors = await listContractors(cookieRequest("https://app.example.test/api/contractors"));
    const assignments = await listAssignments(cookieRequest("https://app.example.test/api/assignments"));
    const dashboard = await getDashboard(cookieRequest(`https://app.example.test/api/dashboard?week=${WEEK}`));
    expect(sites.status).toBe(200);
    expect(await sites.json()).toEqual([]);
    expect(contractors.status).toBe(200);
    expect(await contractors.json()).toEqual({ contractors: [] });
    expect(assignments.status).toBe(200);
    expect(await assignments.json()).toEqual({ assignments: [] });
    expect(dashboard.status).toBe(200);
    expect(await dashboard.json()).toEqual({
      weekStart: WEEK,
      weekEnd: weekEnd(WEEK),
      sites: [],
      contractors: [],
      assignments: [],
      entries: [],
      summary: summarizeWeek([]),
      approval: toDashboardApproval(null),
      business: null,
    });
    expect(count(sqlite, "site")).toBe(0);
    expect(count(sqlite, "contractor")).toBe(0);
    expect(count(sqlite, "assignment")).toBe(0);
    expect(count(sqlite, "time_entry")).toBe(0);
    expect(count(sqlite, "week_approval")).toBe(0);
  });

  it("refuses site create and week approval without a membership and writes nothing", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    const site = await createSite(jsonRequest("https://app.example.test/api/sites", { name: "Harbour", address: "" }));
    expect(site.status).toBe(409);
    expect(await site.json()).toEqual({ error: "business_required" });
    const approval = await approveWeek(jsonRequest("https://app.example.test/api/weeks/approve", {
      weekStart: WEEK,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    }));
    expect(approval.status).toBe(409);
    expect(await approval.json()).toEqual({ error: "business_required" });
    expect(count(sqlite, "site")).toBe(0);
    expect(count(sqlite, "week_approval")).toBe(0);
  });

  it("keeps two owners' sites isolated", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    insertUser(sqlite, "owner-2");
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner One" };
    expect((await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile))).status).toBe(201);
    const created = await createSite(jsonRequest("https://app.example.test/api/sites", { name: "North Hall", address: "" }));
    expect(created.status).toBe(201);
    const site = await created.json() as { id: string; name: string };

    session.user = { id: "owner-2", email: "two@example.test", name: "Owner Two" };
    expect((await createBusiness(jsonRequest("https://app.example.test/api/business", {
      ...validProfile,
      name: "Southwind Cleaning",
      contactEmail: "south@example.test",
    }))).status).toBe(201);
    expect(await (await listSites(cookieRequest("https://app.example.test/api/sites"))).json()).toEqual([]);
    const params = { params: Promise.resolve({ id: site.id }) };
    const read = await getSite(cookieRequest(`https://app.example.test/api/sites/${site.id}`), params);
    expect(read.status).toBe(404);
    expect(await read.json()).toEqual({ error: "not_found" });
    const patched = await patchSite(jsonRequest(`https://app.example.test/api/sites/${site.id}`, { name: "Stolen", address: "" }), params);
    expect(patched.status).toBe(404);
    expect(column(sqlite, `SELECT name FROM site WHERE id = '${site.id}'`)).toEqual([["North Hall"]]);
    expect(column(sqlite, "SELECT DISTINCT business_id FROM site")).toEqual([["biz_owner-1"]]);
  });

  it("sets onboarding once and refuses it without a membership", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    const missing = await completeOnboarding(cookieRequest("https://app.example.test/api/business/onboarding/complete", "POST"));
    expect(missing.status).toBe(409);
    expect(await missing.json()).toEqual({ error: "business_required" });
    expect(count(sqlite, "business")).toBe(0);

    expect((await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile))).status).toBe(201);
    const first = await completeOnboarding(cookieRequest("https://app.example.test/api/business/onboarding/complete", "POST"));
    expect(first.status).toBe(200);
    const completed = await first.json() as { onboardingCompletedAt: string; name: string };
    expect(completed.name).toBe("Northwind Cleaning");
    expect(completed.onboardingCompletedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const second = await completeOnboarding(cookieRequest("https://app.example.test/api/business/onboarding/complete", "POST"));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ onboardingCompletedAt: completed.onboardingCompletedAt });
    const stored = column(sqlite, "SELECT onboarding_completed_at FROM business");
    expect(stored).toHaveLength(1);
    expect(stored[0]?.[0]).toBeTypeOf("number");
  });

  it("requires a session and a trusted origin on business mutations", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    session.user = null;
    const anonymous = await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });

    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner One" };
    const forbidden = await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile, { origin: "https://evil.example" }));
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    const broken = jsonRequest("https://app.example.test/api/business", validProfile);
    const malformed = new Request(broken.url, {
      method: "POST",
      body: "{",
      headers: {
        "content-type": "application/json",
        "content-length": "1",
        cookie: "better-auth.session_token=test",
        origin: ORIGIN,
      },
    });
    const invalid = await createBusiness(malformed);
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
    expect(count(sqlite, "business")).toBe(0);
    expect(count(sqlite, "business_member")).toBe(0);
  });

  it("denies owner workspace creation to a contractor-only account", async () => {
    const sqlite = handle.sqlite!;
    seedOwnerWorkspace(sqlite, "owner-a");
    insertUser(sqlite, "contractor-user");
    sqlite.run("INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status) VALUES ('contractor-a','owner-a','biz_owner-a',1700000000,1700000000,'Contractor A','contractor-user@example.test','',3200,'NZD',1,'active')");
    sqlite.run("INSERT INTO contractor_user (id, owner_user_id, business_id, contractor_id, user_id, created_at, updated_at) VALUES ('link-a','owner-a','biz_owner-a','contractor-a','contractor-user',1700000000,1700000000)");
    session.user = { id: "contractor-user", email: "contractor-user@example.test", name: "Contractor User" };
    const response = await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(count(sqlite, "business")).toBe(1);
  });

  it("attaches the business resource on a dashboard read after membership exists", async () => {
    const sqlite = handle.sqlite!;
    insertUser(sqlite, "owner-1");
    expect((await createBusiness(jsonRequest("https://app.example.test/api/business", validProfile))).status).toBe(201);
    const dashboard = await getDashboard(cookieRequest(`https://app.example.test/api/dashboard?week=${WEEK}`));
    expect(dashboard.status).toBe(200);
    const body = await dashboard.json() as { business: { id: string; name: string }; summary: unknown[]; approval: { status: string } };
    expect(body.business).toMatchObject({ id: "biz_owner-1", name: "Northwind Cleaning", onboardingCompletedAt: null });
    expect(body.summary).toEqual(summarizeWeek([]));
    expect(body.approval).toEqual(toDashboardApproval(null));
    expect(count(sqlite, "site")).toBe(0);
  });
});
