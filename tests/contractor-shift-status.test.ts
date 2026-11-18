import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { portalShiftSubmissionSchema } from "../packages/core/src/portal";
import { contractorShiftStatusInput } from "../src/lib/validation";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";
import { seedOwnerWorkspace } from "./owner-workspace";

const session = vi.hoisted(() => ({
  user: { id: "user-a", email: "aroha@example.test", name: "Aroha" } as { id: string; email: string; name: string } | null,
}));

const handle = vi.hoisted(() => ({ database: null as unknown }));
const lockRace = vi.hoisted(() => ({ afterCheck: null as null | (() => void) }));

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
vi.mock("@/services/week-approval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/services/week-approval")>();
  return {
    ...actual,
    assertUnlockedWeek: async (...args: Parameters<typeof actual.assertUnlockedWeek>) => {
      await actual.assertUnlockedWeek(...args);
      lockRace.afterCheck?.();
    },
  };
});

import { POST as postShiftStatus } from "../src/app/api/portal/shifts/[id]/route";
import { GET as readWeek } from "../src/app/api/portal/week/route";

const WEEK = "2026-10-26";

function rows(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []) {
  return sqlRows(sqlite, sql, params);
}

function entry(sqlite: SqlJsDatabase, id: string) {
  const [row] = rows(
    sqlite,
    `SELECT occurrence_kind, entry_mode, paid_minutes, rate_cents, notes, submission_reason, schedule_version_id
     FROM time_entry WHERE id = ?`,
    [id],
  );
  return row;
}

function count(sqlite: SqlJsDatabase, table: string) {
  return rows(sqlite, `SELECT COUNT(*) FROM ${table}`)[0]?.[0];
}

function post(id: string, body: unknown, extra?: HeadersInit) {
  const payload = JSON.stringify(body);
  const headers = new Headers(extra);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("content-length", String(payload.length));
  return postShiftStatus(new Request(`https://app.example.test/api/portal/shifts/${id}`, {
    method: "POST",
    body: payload,
    headers,
  }), { params: Promise.resolve({ id }) });
}

function mobilePost(id: string, body: unknown) {
  return post(id, body, {
    cookie: "better-auth.session_token=test",
    "x-cleantrack-client": "mobile/0.1.0",
  });
}

describe("contractor shift status", () => {
  let sqlite: SqlJsDatabase;

  beforeEach(async () => {
    lockRace.afterCheck = null;
    session.user = { id: "user-a", email: "aroha@example.test", name: "Aroha" };
    sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Northwind", email: "office@example.test" });
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-a', 'Aroha', 'aroha@example.test', 1, 1, 1)",
    );
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-b', 'Ben', 'ben@example.test', 1, 1, 1)",
    );
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c-a', 'owner-a', 'biz_owner-a', 1, 1, 'Aroha', '', '', 2500, 'NZD', 1)`,
    );
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c-b', 'owner-a', 'biz_owner-a', 1, 1, 'Ben', '', '', 9999, 'NZD', 1)`,
    );
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES ('site-a', 'owner-a', 'biz_owner-a', 1, 1, 'Queen Street', '12 Queen Street', 1)`,
    );
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES ('site-b', 'owner-a', 'biz_owner-a', 1, 1, 'Ben Site', '99 Secret Road', 1)`,
    );
    sqlite.run(
      `INSERT INTO assignment (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, rate_cents, active)
       VALUES ('as-a', 'owner-a', 'biz_owner-a', 1, 1, 'c-a', 'site-a', NULL, 1)`,
    );
    sqlite.run(
      `INSERT INTO assignment (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, rate_cents, active)
       VALUES ('as-b', 'owner-a', 'biz_owner-a', 1, 1, 'c-b', 'site-b', NULL, 1)`,
    );
    sqlite.run(
      `INSERT INTO assignment_schedule_version (
        id, owner_user_id, business_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at
      ) VALUES ('v-a', 'owner-a', 'biz_owner-a', 'as-a', 127, 90, '2020-01-06', NULL, 1, 1)`,
    );
    const insertEntry = (input: {
      id: string;
      contractorId: string;
      siteId: string;
      workDate: string;
      paidMinutes: number;
      rateCents: number;
      occurrenceKind: string;
      scheduleVersionId: string | null;
      notes?: string;
    }) => {
      sqlite.run(
        `INSERT INTO time_entry (
          id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
          start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id
        ) VALUES (?, 'owner-a', 'biz_owner-a', 1, 1, ?, ?, ?, 0, ?, 0, ?, ?, ?, 'paid_hours', ?, ?)`,
        [
          input.id,
          input.contractorId,
          input.siteId,
          input.workDate,
          input.paidMinutes,
          input.paidMinutes,
          input.rateCents,
          input.notes ?? "OWNER NOTE",
          input.occurrenceKind,
          input.scheduleVersionId,
        ],
      );
    };
    insertEntry({
      id: "entry-a",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: WEEK,
      paidMinutes: 90,
      rateCents: 2500,
      occurrenceKind: "scheduled",
      scheduleVersionId: "v-a",
    });
    insertEntry({
      id: "entry-next",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: "2026-10-27",
      paidMinutes: 90,
      rateCents: 2500,
      occurrenceKind: "scheduled",
      scheduleVersionId: "v-a",
    });
    insertEntry({
      id: "entry-b",
      contractorId: "c-b",
      siteId: "site-b",
      workDate: WEEK,
      paidMinutes: 40,
      rateCents: 9999,
      occurrenceKind: "scheduled",
      scheduleVersionId: null,
      notes: "BEN SECRET",
    });
    insertEntry({
      id: "entry-manual",
      contractorId: "c-a",
      siteId: "site-a",
      workDate: "2026-10-28",
      paidMinutes: 30,
      rateCents: 2500,
      occurrenceKind: "manual",
      scheduleVersionId: null,
    });
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES ('acct-a', 'biz_owner-a', 'owner-a', 'c-a', 'user-a', 1, 1, 1)`,
    );
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES ('acct-b', 'biz_owner-a', 'owner-a', 'c-b', 'user-b', 1, 1, 1)`,
    );
  });

  it("rejects a client-supplied contractor identity", () => {
    expect(contractorShiftStatusInput.safeParse({
      action: "worked_as_scheduled",
      contractorId: "c-b",
      businessId: "biz_owner-a",
      rateCents: 1,
    }).success).toBe(false);
    expect(contractorShiftStatusInput.safeParse({ action: "different_hours", paidMinutes: 75, reason: "Finished early" }).data).toEqual({
      action: "different_hours",
      paidMinutes: 75,
      reason: "Finished early",
    });
  });

  it("confirms worked as scheduled and keeps the snapshotted rate", async () => {
    const response = await mobilePost("entry-a", { action: "worked_as_scheduled" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(portalShiftSubmissionSchema.parse(body)).toMatchObject({ occurrenceKind: "worked", paidMinutes: 90, reason: "", recorded: true, locked: false });
    expect(JSON.stringify(body)).not.toContain("2500");
    expect(JSON.stringify(body)).not.toContain("OWNER NOTE");
    expect(entry(sqlite, "entry-a")).toEqual(["worked", "paid_hours", 90, 2500, "OWNER NOTE", "", "v-a"]);
    expect(entry(sqlite, "entry-next")).toEqual(["scheduled", "paid_hours", 90, 2500, "OWNER NOTE", "", "v-a"]);
    expect(rows(sqlite, "SELECT paid_minutes, effective_to FROM assignment_schedule_version WHERE id = 'v-a'")[0]).toEqual([90, null]);
    expect(count(sqlite, "time_entry")).toBe(4);
    const audit = rows(sqlite, "SELECT actor_user_id, action, old_json, new_json FROM owner_time_entry_audit");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.[0]).toBe("user-a");
    expect(audit[0]?.[1]).toBe("confirm_worked");
    expect(String(audit[0]?.[2])).not.toContain("OWNER NOTE");
    expect(String(audit[0]?.[3])).not.toContain("2500");
  });

  it("reloads the confirmed status from the server", async () => {
    expect((await mobilePost("entry-a", { action: "worked_as_scheduled" })).status).toBe(200);
    const response = await readWeek(new Request(`https://app.example.test/api/portal/week?week=${WEEK}&submission=1`, {
      headers: { cookie: "better-auth.session_token=test", "x-cleantrack-client": "mobile/0.1.0" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json() as { days: Array<{ shifts: Array<{ id: string; occurrenceKind: string; paidMinutes: number }> }> };
    const saved = body.days.flatMap((day) => day.shifts).find((shift) => shift.id === "entry-a");
    expect(saved).toMatchObject({ occurrenceKind: "worked", paidMinutes: 90, recorded: true });
    const plain = await readWeek(new Request(`https://app.example.test/api/portal/week?week=${WEEK}`, {
      headers: { cookie: "better-auth.session_token=test" },
    }));
    const plainBody = await plain.json() as { days: Array<{ shifts: Array<Record<string, unknown>> }> };
    const plainShift = plainBody.days.flatMap((day) => day.shifts).find((shift) => shift.id === "entry-a");
    expect(plainShift).not.toHaveProperty("reason");
    expect(plainShift).not.toHaveProperty("locked");
    expect(JSON.stringify(plainBody)).not.toContain("OWNER NOTE");
  });

  it("records an absence for that date only", async () => {
    const response = await mobilePost("entry-a", { action: "absent" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ occurrenceKind: "absent", paidMinutes: 0 });
    expect(entry(sqlite, "entry-a")).toEqual(["absent", "absent", 0, 2500, "OWNER NOTE", "", "v-a"]);
    expect(entry(sqlite, "entry-next")?.[0]).toBe("scheduled");
    expect(entry(sqlite, "entry-next")?.[2]).toBe(90);
    expect(rows(sqlite, "SELECT paid_minutes FROM assignment_schedule_version WHERE id = 'v-a'")[0]).toEqual([90]);
    expect(count(sqlite, "time_entry")).toBe(4);
  });

  it("changes hours for one occurrence and stores a short reason", async () => {
    const response = await mobilePost("entry-a", { action: "different_hours", paidMinutes: 75, reason: "Finished early" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      occurrenceKind: "hours_override",
      paidMinutes: 75,
      reason: "Finished early",
    });
    expect(entry(sqlite, "entry-a")).toEqual(["hours_override", "paid_hours", 75, 2500, "OWNER NOTE", "Finished early", "v-a"]);
    expect(entry(sqlite, "entry-next")?.[2]).toBe(90);
    expect(rows(sqlite, "SELECT paid_minutes, effective_to FROM assignment_schedule_version WHERE id = 'v-a'")[0]).toEqual([90, null]);
    const audit = rows(sqlite, "SELECT new_json FROM owner_time_entry_audit WHERE entry_id = 'entry-a'");
    expect(String(audit[0]?.[0])).not.toContain("Finished early");
    expect(count(sqlite, "assignment_schedule_version")).toBe(1);
  });

  it("restores scheduled minutes without repricing when worked as scheduled follows an hours change", async () => {
    expect((await mobilePost("entry-a", { action: "different_hours", paidMinutes: 75, reason: "Finished early" })).status).toBe(200);
    const response = await mobilePost("entry-a", { action: "worked_as_scheduled" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ occurrenceKind: "worked", paidMinutes: 90, reason: "" });
    expect(entry(sqlite, "entry-a")?.[2]).toBe(90);
    expect(entry(sqlite, "entry-a")?.[3]).toBe(2500);
    expect(count(sqlite, "time_entry")).toBe(4);
  });

  it("repeats the same action without a second payable entry", async () => {
    expect((await mobilePost("entry-a", { action: "worked_as_scheduled" })).status).toBe(200);
    const again = await mobilePost("entry-a", { action: "worked_as_scheduled" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ id: "entry-a", occurrenceKind: "worked", paidMinutes: 90 });
    expect(count(sqlite, "time_entry")).toBe(4);
    expect(count(sqlite, "owner_time_entry_audit")).toBe(1);
    expect(rows(sqlite, "SELECT id FROM time_entry WHERE contractor_id = 'c-a' AND work_date = ?", [WEEK])).toEqual([["entry-a"]]);
  });

  it("rejects a locked week and writes nothing", async () => {
    sqlite.run(
      `INSERT INTO week_approval (
        id, owner_user_id, business_id, created_at, updated_at, week_start, status, approved_at, reopened_at
      ) VALUES ('wa-a', 'owner-a', 'biz_owner-a', 1, 1, ?, 'approved', 1, NULL)`,
      [WEEK],
    );
    const before = entry(sqlite, "entry-a");
    const response = await mobilePost("entry-a", { action: "absent" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "week_locked" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
    expect(count(sqlite, "time_entry")).toBe(4);
  });

  it("does not let one contractor update another contractor's occurrence", async () => {
    const before = entry(sqlite, "entry-b");
    const response = await mobilePost("entry-b", { action: "worked_as_scheduled" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(entry(sqlite, "entry-b")).toEqual(before);
    expect(before?.[3]).toBe(9999);
    expect(count(sqlite, "time_entry")).toBe(4);
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
  });

  it("rejects a forged contractor id without writing", async () => {
    const before = entry(sqlite, "entry-a");
    const response = await mobilePost("entry-a", { action: "absent", contractorId: "c-b" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
  });

  it("leaves a manual entry unchanged", async () => {
    const before = entry(sqlite, "entry-manual");
    const response = await mobilePost("entry-manual", { action: "absent" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "no_schedule" });
    expect(entry(sqlite, "entry-manual")).toEqual(before);
  });

  function approveWeek(ownerUserId = "owner-a", weekStart = WEEK) {
    sqlite.run(
      `INSERT INTO week_approval (
        id, owner_user_id, business_id, created_at, updated_at, week_start, status, approved_at, reopened_at
      ) VALUES (?, ?, ?, 1, 1, ?, 'approved', 1, NULL)`,
      [`wa-${ownerUserId}-${weekStart}`, ownerUserId, `biz_${ownerUserId}`, weekStart],
    );
  }

  it("rejects a write when the week is approved after the lock check", async () => {
    const before = entry(sqlite, "entry-a");
    lockRace.afterCheck = () => approveWeek();
    const response = await mobilePost("entry-a", { action: "absent" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "week_locked" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
  });

  it("rejects a reason-only write when the week is approved after the lock check", async () => {
    expect((await mobilePost("entry-a", { action: "different_hours", paidMinutes: 75, reason: "one" })).status).toBe(200);
    const before = entry(sqlite, "entry-a");
    lockRace.afterCheck = () => approveWeek();
    const response = await mobilePost("entry-a", { action: "different_hours", paidMinutes: 75, reason: "two" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "week_locked" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
    expect(count(sqlite, "owner_time_entry_audit")).toBe(1);
  });

  it("does not update an occurrence in another business", async () => {
    seedOwnerWorkspace(sqlite, "owner-b", { name: "Harbour", email: "harbour@example.test" });
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c-h', 'owner-b', 'biz_owner-b', 1, 1, 'Harbour', '', '', 4000, 'NZD', 1)`,
    );
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES ('site-h', 'owner-b', 'biz_owner-b', 1, 1, 'Harbour Site', '', 1)`,
    );
    sqlite.run(
      `INSERT INTO time_entry (
        id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
        start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id
      ) VALUES ('entry-h', 'owner-b', 'biz_owner-b', 1, 1, 'c-h', 'site-h', ?, 0, 90, 0, 90, 4000, '', 'paid_hours', 'scheduled', 'v-h')`,
      [WEEK],
    );
    const response = await mobilePost("entry-h", { action: "absent" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(entry(sqlite, "entry-h")?.[0]).toBe("scheduled");
    expect(entry(sqlite, "entry-a")?.[0]).toBe("scheduled");
  });

  it("does not let an owner-only session update a contractor occurrence", async () => {
    session.user = { id: "owner-a", email: "office@example.test", name: "Northwind" };
    const before = entry(sqlite, "entry-a");
    const response = await mobilePost("entry-a", { action: "absent" });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
  });

  it("hides suspended and archived contractors from the status write", async () => {
    sqlite.run("UPDATE contractor SET engagement_status = 'suspended', active = 0 WHERE id = 'c-a'");
    const suspended = await mobilePost("entry-a", { action: "absent" });
    expect(suspended.status).toBe(404);
    expect(entry(sqlite, "entry-a")?.[0]).toBe("scheduled");
    sqlite.run("UPDATE contractor SET engagement_status = 'archived', active = 0 WHERE id = 'c-a'");
    const archived = await mobilePost("entry-a", { action: "absent" });
    expect(archived.status).toBe(404);
    expect(entry(sqlite, "entry-a")?.[0]).toBe("scheduled");
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
  });

  it("rejects minutes outside 1 to 1439 and a reason longer than 200 characters", async () => {
    const before = entry(sqlite, "entry-a");
    for (const paidMinutes of [0, 1440]) {
      const response = await mobilePost("entry-a", { action: "different_hours", paidMinutes });
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_request" });
    }
    const longReason = await mobilePost("entry-a", { action: "different_hours", paidMinutes: 75, reason: "x".repeat(201) });
    expect(longReason.status).toBe(400);
    expect(await longReason.json()).toEqual({ error: "invalid_request" });
    expect(entry(sqlite, "entry-a")).toEqual(before);
  });

  it("rejects a shift dated after today in Pacific/Auckland", async () => {
    sqlite.run(
      `INSERT INTO time_entry (
        id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
        start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id
      ) VALUES ('entry-future', 'owner-a', 'biz_owner-a', 1, 1, 'c-a', 'site-a', '2099-06-01', 0, 90, 0, 90, 2500, 'OWNER NOTE', 'paid_hours', 'scheduled', 'v-a')`,
    );
    const response = await mobilePost("entry-future", { action: "worked_as_scheduled" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "future_shift" });
    expect(entry(sqlite, "entry-future")?.[0]).toBe("scheduled");
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
  });

  it("requires a session and a trusted mobile client", async () => {
    const signedOut = await post("entry-a", { action: "absent" }, { "x-cleantrack-client": "mobile/0.1.0" });
    expect(signedOut.status).toBe(401);
    const forged = await post("entry-a", { action: "absent" }, {
      cookie: "better-auth.session_token=test",
      origin: "https://evil.example",
    });
    expect(forged.status).toBe(403);
    expect(entry(sqlite, "entry-a")?.[0]).toBe("scheduled");
    expect(count(sqlite, "owner_time_entry_audit")).toBe(0);
  });
});
