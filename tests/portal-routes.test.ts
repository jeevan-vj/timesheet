import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPortalSqlite, portalDatabase } from "./portal-db";
import { seedOwnerWorkspace } from "./owner-workspace";

const session = vi.hoisted(() => ({
  user: { id: "user-a", email: "aroha@example.test", name: "Aroha" } as { id: string; email: string; name: string } | null,
}));

const handle = vi.hoisted(() => ({ database: null as unknown }));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
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
    if (!request.headers.get("cookie")) return null;
    return session.user;
  },
}));

import { GET as readPayment } from "../src/app/api/portal/payments/[week]/route";
import { GET as readPayments } from "../src/app/api/portal/payments/route";
import { GET as readUpcoming } from "../src/app/api/portal/upcoming/route";
import { GET as readWeek } from "../src/app/api/portal/week/route";

const FORBIDDEN_KEYS = ["notes", "rateCents", "rate", "email", "phone", "internalNotes", "gstNumber", "ownerUserId", "token", "password", "defaultRateCents"];
const SECRET_TEXT = ["OWNER PRIVATE NOTE", "BEN SECRET", "SECRET INTERNAL", "HARBOUR SECRET"];

function keysDeep(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.push(key);
      keysDeep(child, found);
    }
  }
  return found;
}

function mobileRequest(path: string) {
  return new Request(`https://app.example.test${path}`, {
    headers: {
      cookie: "better-auth.session_token=test",
      "x-cleantrack-client": "mobile/0.1.0",
    },
  });
}

function insertUser(sqlite: SqlJsDatabase, id: string, email: string, name: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, 1700000000, 1700000000)",
    [id, name, email],
  );
}

function insertContractor(sqlite: SqlJsDatabase, id: string, ownerUserId: string, name: string, rate: number) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, internal_notes
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, '', '', ?, 'NZD', 1, 'SECRET INTERNAL')`,
    [id, ownerUserId, `biz_${ownerUserId}`, name, rate],
  );
}

function insertSite(sqlite: SqlJsDatabase, id: string, ownerUserId: string, name: string, address: string) {
  sqlite.run(
    `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
     VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, 1)`,
    [id, ownerUserId, `biz_${ownerUserId}`, name, address],
  );
}

function insertAssignment(sqlite: SqlJsDatabase, id: string, ownerUserId: string, contractorId: string, siteId: string) {
  sqlite.run(
    `INSERT INTO assignment (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, rate_cents, active)
     VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, NULL, 1)`,
    [id, ownerUserId, `biz_${ownerUserId}`, contractorId, siteId],
  );
}

function insertEntry(sqlite: SqlJsDatabase, input: {
  id: string;
  ownerUserId: string;
  contractorId: string;
  siteId: string;
  workDate: string;
  paidMinutes: number;
  rateCents: number;
  notes: string;
  entryMode?: string;
  occurrenceKind?: string;
  startMinutes?: number;
  endMinutes?: number;
}) {
  const start = input.startMinutes ?? 0;
  const end = input.endMinutes ?? input.paidMinutes;
  sqlite.run(
    `INSERT INTO time_entry (
      id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
      start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    [
      input.id,
      input.ownerUserId,
      `biz_${input.ownerUserId}`,
      input.contractorId,
      input.siteId,
      input.workDate,
      start,
      end,
      input.paidMinutes,
      input.rateCents,
      input.notes,
      input.entryMode ?? "paid_hours",
      input.occurrenceKind ?? "manual",
    ],
  );
}

function linkAccount(sqlite: SqlJsDatabase, id: string, ownerUserId: string, contractorId: string, userId: string, active = 1) {
  sqlite.run(
    `INSERT INTO contractor_account (
      id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1700000000, 1700000000)`,
    [id, `biz_${ownerUserId}`, ownerUserId, contractorId, userId, active],
  );
}

function approve(sqlite: SqlJsDatabase, id: string, ownerUserId: string, weekStart: string, status: "approved" | "reopened") {
  sqlite.run(
    `INSERT INTO week_approval (
      id, owner_user_id, business_id, created_at, updated_at, week_start, status, approved_at, reopened_at
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, 1700000000, ?)`,
    [id, ownerUserId, `biz_${ownerUserId}`, weekStart, status, status === "reopened" ? 1700000100 : null],
  );
}

describe("contractor portal reads", () => {
  let sqlite: SqlJsDatabase;

  beforeEach(async () => {
    session.user = { id: "user-a", email: "aroha@example.test", name: "Aroha" };
    sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Northwind", email: "office@example.test" });
    seedOwnerWorkspace(sqlite, "owner-b", { name: "Harbour", email: "harbour@example.test" });
    sqlite.run("UPDATE business SET name = 'Northwind' WHERE id = 'biz_owner-a'");
    sqlite.run("UPDATE business SET name = 'Harbour' WHERE id = 'biz_owner-b'");
    insertUser(sqlite, "user-a", "aroha@example.test", "Aroha");
    insertUser(sqlite, "user-b", "ben@example.test", "Ben");
    insertContractor(sqlite, "c-a", "owner-a", "Aroha", 3200);
    insertContractor(sqlite, "c-b", "owner-a", "Ben", 7777);
    insertContractor(sqlite, "c-h", "owner-b", "Aroha Harbour", 4000);
    insertSite(sqlite, "site-a", "owner-a", "Queen Street", "12 Queen Street, Auckland");
    insertSite(sqlite, "site-b", "owner-a", "Ben Site", "99 Secret Road");
    insertSite(sqlite, "site-h", "owner-b", "Harbour Site", "4 Wharf Lane");
    insertAssignment(sqlite, "as-a", "owner-a", "c-a", "site-a");
    insertAssignment(sqlite, "as-b", "owner-a", "c-b", "site-b");
    sqlite.run(
      `INSERT INTO assignment_schedule_version (
        id, owner_user_id, business_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at
      ) VALUES ('v-a', 'owner-a', 'biz_owner-a', 'as-a', 31, 60, '2020-01-06', NULL, 1700000000, 1700000000)`,
    );
    sqlite.run(
      `INSERT INTO assignment_schedule_version (
        id, owner_user_id, business_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at
      ) VALUES ('v-b', 'owner-a', 'biz_owner-a', 'as-b', 31, 45, '2020-01-06', NULL, 1700000000, 1700000000)`,
    );
    insertEntry(sqlite, {
      id: "entry-a",
      ownerUserId: "owner-a",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: "2026-10-27",
      paidMinutes: 180,
      rateCents: 3200,
      notes: "OWNER PRIVATE NOTE",
      entryMode: "clock",
      occurrenceKind: "worked",
      startMinutes: 540,
      endMinutes: 720,
    });
    insertEntry(sqlite, {
      id: "entry-old",
      ownerUserId: "owner-a",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: "2026-10-20",
      paidMinutes: 90,
      rateCents: 3200,
      notes: "OLD NOTE",
    });
    insertEntry(sqlite, {
      id: "entry-b",
      ownerUserId: "owner-a",
      contractorId: "c-b",
      siteId: "site-b",
      workDate: "2026-10-27",
      paidMinutes: 60,
      rateCents: 7777,
      notes: "BEN SECRET",
      entryMode: "clock",
      occurrenceKind: "worked",
      startMinutes: 480,
      endMinutes: 540,
    });
    insertEntry(sqlite, {
      id: "entry-b-old",
      ownerUserId: "owner-a",
      contractorId: "c-b",
      siteId: "site-b",
      workDate: "2026-10-20",
      paidMinutes: 60,
      rateCents: 7777,
      notes: "BEN SECRET",
    });
    insertEntry(sqlite, {
      id: "entry-h",
      ownerUserId: "owner-b",
      contractorId: "c-h",
      siteId: "site-h",
      workDate: "2026-10-20",
      paidMinutes: 60,
      rateCents: 4000,
      notes: "HARBOUR SECRET",
    });
    insertEntry(sqlite, {
      id: "entry-reopened",
      ownerUserId: "owner-a",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: "2026-10-13",
      paidMinutes: 30,
      rateCents: 3200,
      notes: "REOPENED NOTE",
    });
    approve(sqlite, "wa-a", "owner-a", "2026-10-19", "approved");
    approve(sqlite, "wa-h", "owner-b", "2026-10-19", "approved");
    approve(sqlite, "wa-re", "owner-a", "2026-10-12", "reopened");
    linkAccount(sqlite, "acct-a", "owner-a", "c-a", "user-a");
    linkAccount(sqlite, "acct-h", "owner-b", "c-h", "user-a");
    linkAccount(sqlite, "acct-b", "owner-a", "c-b", "user-b");
    sqlite.run("UPDATE contractor SET default_rate_cents = 5000 WHERE id = 'c-a'");
  });

  it("returns 401 without a mobile session", async () => {
    session.user = null;
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-26"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("accepts the mobile session cookie without an Origin and ignores a bearer token alone", async () => {
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-26"));
    expect(response.status).toBe(200);
    const bearerOnly = await readWeek(new Request("https://app.example.test/api/portal/week?week=2026-10-26", {
      headers: { authorization: "Bearer test-session", "x-cleantrack-client": "mobile/0.1.0" },
    }));
    expect(bearerOnly.status).toBe(401);
  });

  it("shows contractor A their own week and hides contractor B", async () => {
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-26&contractorId=c-b"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      days: Array<{ date: string; shifts: Array<{ siteName: string; id: string; occurrenceKind: string; startMinutes: number | null }> }>;
      tasks: Array<{ title: string }>;
    };
    const shifts = body.days.flatMap((day) => day.shifts);
    const names = shifts.map((shift) => shift.siteName);
    expect(names).toContain("Queen Street");
    expect(names).not.toContain("Ben Site");
    expect(names).not.toContain("Harbour Site");
    const tuesday = shifts.find((shift) => shift.id === "entry-a");
    expect(tuesday).toMatchObject({ occurrenceKind: "worked", startMinutes: 540 });
    const wednesday = body.days.find((day) => day.date === "2026-10-28")?.shifts ?? [];
    expect(wednesday.map((shift) => shift.occurrenceKind)).toEqual(["scheduled"]);
    expect(body.tasks[0]?.title).toBe("4 shifts still pending");
    expect(JSON.stringify(body)).not.toContain("OWNER PRIVATE NOTE");
    expect(JSON.stringify(body)).not.toContain("BEN SECRET");
    expect(JSON.stringify(body)).not.toContain("SECRET INTERNAL");
    for (const key of FORBIDDEN_KEYS) expect(keysDeep(body)).not.toContain(key);
    expect(keysDeep(body)).not.toContain("payCents");
  });

  it("includes a second business the same person works for, and not the owner's other contractors", async () => {
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-19"));
    const body = await response.json() as { days: Array<{ shifts: Array<{ siteName: string }> }> };
    const names = body.days.flatMap((day) => day.shifts).map((shift) => shift.siteName);
    expect(names).toEqual(expect.arrayContaining(["Queen Street", "Harbour Site"]));
    expect(names).not.toContain("Ben Site");
  });

  it("does not let an owner session read contractor rows they are not linked to", async () => {
    session.user = { id: "owner-a", email: "office@example.test", name: "Northwind" };
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-26"));
    const body = await response.json() as { days: Array<{ shifts: unknown[] }>; tasks: unknown[] };
    expect(body.days.every((day) => day.shifts.length === 0)).toBe(true);
    expect(body.tasks).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Queen Street");
  });

  it("hides suspended contractors and inactive links", async () => {
    sqlite.run("UPDATE contractor SET engagement_status = 'suspended', active = 0 WHERE id = 'c-a'");
    sqlite.run("UPDATE contractor_account SET active = 0 WHERE id = 'acct-h'");
    const response = await readWeek(mobileRequest("/api/portal/week?week=2026-10-26"));
    const body = await response.json() as { days: Array<{ shifts: unknown[] }> };
    expect(body.days.every((day) => day.shifts.length === 0)).toBe(true);
  });

  it("keeps upcoming inside 14 days and on the signed-in contractor", async () => {
    const response = await readUpcoming(mobileRequest("/api/portal/upcoming?days=14&contractorId=c-b"));
    expect(response.status).toBe(200);
    const body = await response.json() as { from: string; to: string; days: Array<{ date: string; shifts: Array<{ siteName: string }> }> };
    const from = new Date(`${body.from}T00:00:00.000Z`);
    const to = new Date(`${body.to}T00:00:00.000Z`);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(13);
    const names = body.days.flatMap((day) => day.shifts).map((shift) => shift.siteName);
    expect(names).toContain("Queen Street");
    expect(names).not.toContain("Ben Site");
    for (const day of body.days) {
      expect(day.date >= body.from && day.date <= body.to).toBe(true);
    }
    expect(JSON.stringify(body)).not.toContain("BEN SECRET");
    const tooWide = await readUpcoming(mobileRequest("/api/portal/upcoming?days=15"));
    expect(tooWide.status).toBe(400);
  });

  it("pays approved weeks from the snapshotted rate and omits other contractors", async () => {
    const response = await readPayments(mobileRequest("/api/portal/payments?week=2026-10-26&contractorId=c-b"));
    expect(response.status).toBe(200);
    const body = await response.json() as {
      headline: { paidMinutes: number; payCents: number; estimated: boolean };
      weeks: Array<{ weekStart: string; paidMinutes: number; payCents: number }>;
    };
    expect(body.headline).toMatchObject({ estimated: true });
    expect(body.headline.payCents).toBe(9600 + 4 * 5000);
    expect(body.weeks).toEqual([
      expect.objectContaining({ weekStart: "2026-10-19", paidMinutes: 150, payCents: 4800 + 4000 }),
    ]);
    expect(JSON.stringify(body)).not.toContain("7777");
    expect(JSON.stringify(body)).not.toContain("2026-10-12");
    for (const secret of SECRET_TEXT) expect(JSON.stringify(body)).not.toContain(secret);
    for (const key of ["notes", "rateCents", "defaultRateCents"]) expect(keysDeep(body)).not.toContain(key);
  });

  it("returns approved line items for the signed-in contractor only", async () => {
    const response = await readPayment(mobileRequest("/api/portal/payments/2026-10-19"), { params: Promise.resolve({ week: "2026-10-19" }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { payCents: number; lines: Array<{ siteName: string; payCents: number }> };
    expect(body.payCents).toBe(8800);
    expect(body.lines.map((line) => line.siteName).sort()).toEqual(["Harbour Site", "Queen Street"]);
    expect(body.lines.find((line) => line.siteName === "Queen Street")?.payCents).toBe(4800);

    session.user = { id: "user-b", email: "ben@example.test", name: "Ben" };
    const ben = await readPayment(mobileRequest("/api/portal/payments/2026-10-19"), { params: Promise.resolve({ week: "2026-10-19" }) });
    const benBody = await ben.json() as { lines: Array<{ siteName: string; payCents: number }> };
    expect(benBody.lines).toEqual([expect.objectContaining({ siteName: "Ben Site", payCents: 7777 })]);

    session.user = { id: "user-a", email: "aroha@example.test", name: "Aroha" };
    const open = await readPayment(mobileRequest("/api/portal/payments/2026-10-26"), { params: Promise.resolve({ week: "2026-10-26" }) });
    expect(open.status).toBe(404);
  });
});
