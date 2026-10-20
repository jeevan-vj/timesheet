import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { opsBearerAuthorized, timingSafeEqual } from "../src/lib/ops-auth";
import { planOpsSql, sqlJsRunner, type SqlValue } from "../src/lib/ops-sql";
import { summarizeWeek, weekPayrollTotals } from "../src/lib/payroll";
import { summarizeWeekBySite } from "../src/lib/week-rollup";
import { execContractorEngagementMigration, seedOwnerWorkspace } from "./owner-workspace";
import { createAssignment, createContractor, createSite, createTimeEntry, updateContractor } from "../src/services/timesheet";
import { approveWeek } from "../src/services/week-approval";
import {
  LONG_DAY_MINUTES,
  opsArchiveContractor,
  opsChangeContractorRate,
  opsRestoreContractor,
  opsCreateContractor,
  opsCreateTimeEntry,
  opsExecuteSql,
  opsPreviewSql,
  opsRevert,
  opsUpdateContractor,
  opsWages,
} from "../src/services/ops";

const SECRET = "ops-test-token";
const MIGRATIONS = [
  "drizzle/0000_initial.sql",
  "drizzle/0001_entry_mode.sql",
  "drizzle/0002_week_approval.sql",
  "drizzle/0003_recurring_schedules.sql",
  "drizzle/0004_business_workspace.sql",
  "drizzle/0005_ops_audit.sql",
];

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  for (const file of MIGRATIONS) sqlite.exec(fs.readFileSync(path.resolve(file), "utf8"));
  execContractorEngagementMigration(sqlite);
  const database = drizzle(sqlite) as unknown as Parameters<typeof opsCreateContractor>[0];
  return { sqlite, database, runner: sqlJsRunner(sqlite) };
}

function auditActions(sqlite: SqlJsDatabase) {
  const result = sqlite.exec("SELECT action, reason, row_count FROM ops_audit ORDER BY created_at, rowid");
  if (result.length === 0) return [];
  return result[0]!.values.map((row) => ({ action: String(row[0]), reason: String(row[1]), rowCount: Number(row[2]) }));
}

function scalar(sqlite: SqlJsDatabase, sql: string, params: SqlValue[] = []) {
  const stmt = sqlite.prepare(sql);
  stmt.bind(params);
  const value = stmt.step() ? stmt.get()[0] : undefined;
  stmt.free();
  return value;
}

async function seedWorkspace(database: Parameters<typeof createContractor>[0], sqlite: SqlJsDatabase, ownerUserId: string) {
  seedOwnerWorkspace(sqlite, ownerUserId);
  const site = await createSite(database, ownerUserId, { name: `${ownerUserId}-harbour`, address: "" });
  const otherSite = await createSite(database, ownerUserId, { name: `${ownerUserId}-warehouse`, address: "" });
  const contractor = await createContractor(database, ownerUserId, {
    name: `${ownerUserId}-aroha`,
    email: "",
    phone: "",
    defaultRateCents: 3_000,
  });
  const assignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: site.id,
    rateCents: null,
  });
  const otherAssignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: otherSite.id,
    rateCents: 2_800,
  });
  return { site, otherSite, contractor, assignment, otherAssignment };
}

describe("ops bearer auth", () => {
  it("accepts only the exact bearer secret", async () => {
    expect(await opsBearerAuthorized("Bearer ops-test-token", SECRET)).toBe(true);
    expect(await opsBearerAuthorized("Bearer ops-test-token-x", SECRET)).toBe(false);
    expect(await opsBearerAuthorized("Bearer xops-test-token", SECRET)).toBe(false);
    expect(await opsBearerAuthorized("Bearer short", SECRET)).toBe(false);
    expect(await opsBearerAuthorized("bearer ops-test-token", SECRET)).toBe(false);
    expect(await opsBearerAuthorized(null, SECRET)).toBe(false);
    expect(await opsBearerAuthorized("Bearer ", SECRET)).toBe(false);
    expect(await opsBearerAuthorized("Bearer ops-test-token", "")).toBe(false);
    expect(await opsBearerAuthorized("Bearer ", "")).toBe(false);
    const hash = new Uint8Array(32).fill(7);
    expect(timingSafeEqual(hash, hash)).toBe(true);
    const flipped = new Uint8Array(hash);
    flipped[31] = 8;
    expect(timingSafeEqual(hash, flipped)).toBe(false);
  });
});

describe("ops sql guardrails", () => {
  const forbidden = [
    "DROP TABLE site",
    "drop table site",
    "ALTER TABLE site ADD COLUMN x text",
    "CREATE TABLE x (id text)",
    "PRAGMA table_info(site)",
    "ATTACH DATABASE 'x' AS extra",
    "DETACH DATABASE extra",
    "DELETE FROM site",
    "delete from time_entry where id = 'x'",
    "SELECT 1; DELETE FROM site",
    "UPDATE site SET name = 'a'; UPDATE site SET name = 'b'",
    "UPDATE ops_audit SET reason = 'x'",
    "INSERT INTO ops_audit (id, action, reason, row_count, created_at) VALUES ('1', 'x', 'y', 1, 1)",
    "UPDATE \"ops_audit\" SET reason = 'no'",
    "UPDATE contractor SET active = 0 WHERE id = 'c1'",
    "UPDATE contractor SET active=1",
    "UPDATE \"contractor\" SET \"active\" = 0 WHERE id = 'c1'",
    "UPDATE contractor SET name = 'A', active = 0 WHERE id = 'c1'",
    "REPLACE INTO site (id) VALUES ('x')",
    "WITH x AS (SELECT 1) SELECT * FROM x",
  ];

  it("rejects destructive, multi-statement, and ops_audit writes", () => {
    for (const sql of forbidden) {
      const planned = planOpsSql(sql, []);
      expect(planned.ok, sql).toBe(false);
    }
    expect(planOpsSql("/* DROP */ SELECT 1", []).ok).toBe(false);
    expect(planOpsSql("SELECT 1 -- comment", []).ok).toBe(false);
  });

  it("allows a select and an update whose string contains DROP", () => {
    expect(planOpsSql("SELECT 'DROP TABLE site' AS label", []).ok).toBe(true);
    expect(planOpsSql("SELECT * FROM ops_audit", []).ok).toBe(true);
    expect(planOpsSql("UPDATE site SET address = 'DROP TABLE site' WHERE id = ?", ["site-1"]).ok).toBe(true);
    expect(planOpsSql("UPDATE site SET address = ? WHERE id = ?;", ["Pier", "site-1"]).ok).toBe(true);
    expect(planOpsSql("UPDATE contractor SET name = 'A' WHERE active = 0", []).ok).toBe(true);
    expect(planOpsSql("UPDATE site SET active = 0 WHERE id = ?", ["site-1"]).ok).toBe(true);
  });

  it("caps select rows and does not write on a rejected delete", async () => {
    const { sqlite, runner } = await openMemoryDb();
    for (let i = 0; i < 101; i += 1) {
      sqlite.run("INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, 1, 1)", [`id-${i}`, `key-${i}`]);
    }
    const selected = await opsPreviewSql(runner, { sql: "SELECT id FROM rate_limit", params: [], secret: SECRET, nowMs: 1_000 });
    expect(selected).toMatchObject({ kind: "select", rowCount: 100, truncated: true });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM rate_limit")).toBe(101);

    await expect(opsPreviewSql(runner, {
      sql: "DELETE FROM rate_limit",
      params: [],
      secret: SECRET,
      nowMs: 1_000,
    })).rejects.toThrow("forbidden_sql");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM rate_limit")).toBe(101);
    expect(auditActions(sqlite)).toEqual([]);
  });

  it("dry-runs an update, then executes once with the confirm token", async () => {
    const { sqlite, database, runner } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    const sql = "UPDATE site SET address = ? WHERE id = ?";
    const params: SqlValue[] = ["Pier", owner.site.id];
    const preview = await opsPreviewSql(runner, { sql, params, secret: SECRET, nowMs: 1_000 });
    expect(preview).toMatchObject({ kind: "dry_run", rowCount: 1 });
    if (preview.kind !== "dry_run") throw new Error("expected dry run");
    expect(preview.sample[0]?.address).toBe("");
    expect(scalar(sqlite, "SELECT address FROM site WHERE id = ?", [owner.site.id])).toBe("");
    expect(auditActions(sqlite)).toEqual([]);

    const executed = await opsExecuteSql(runner, {
      sql,
      params,
      confirmToken: preview.confirmToken,
      reason: "Correct the site address",
      secret: SECRET,
      nowMs: 2_000,
    });
    expect(executed.rowCount).toBe(1);
    expect(scalar(sqlite, "SELECT address FROM site WHERE id = ?", [owner.site.id])).toBe("Pier");
    expect(auditActions(sqlite)).toEqual([{ action: "sql.update", reason: "Correct the site address", rowCount: 1 }]);

    await expect(opsExecuteSql(runner, {
      sql,
      params,
      confirmToken: preview.confirmToken,
      reason: "Correct the site address",
      secret: SECRET,
      nowMs: 3_000,
    })).rejects.toThrow("confirm_used");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM ops_audit")).toBe(1);
  });

  it("rejects an expired token, a mismatched token, and a stale preview without writing", async () => {
    const { sqlite, database, runner } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    const sql = "UPDATE site SET address = ? WHERE id = ? AND address = ?";
    const params: SqlValue[] = ["Pier", owner.site.id, ""];
    const preview = await opsPreviewSql(runner, { sql, params, secret: SECRET, nowMs: 1_000 });
    if (preview.kind !== "dry_run") throw new Error("expected dry run");

    await expect(opsExecuteSql(runner, {
      sql,
      params,
      confirmToken: preview.confirmToken,
      reason: "Too late",
      secret: SECRET,
      nowMs: 1_000 + 5 * 60 * 1000 + 1,
    })).rejects.toThrow("confirm_expired");

    await expect(opsExecuteSql(runner, {
      sql,
      params,
      confirmToken: "v1.not-a-token.sig",
      reason: "Wrong token",
      secret: SECRET,
      nowMs: 1_000,
    })).rejects.toThrow("confirm_mismatch");

    sqlite.run("UPDATE site SET address = ? WHERE id = ?", ["kept", owner.site.id]);
    await expect(opsExecuteSql(runner, {
      sql,
      params,
      confirmToken: preview.confirmToken,
      reason: "Stale",
      secret: SECRET,
      nowMs: 1_500,
    })).rejects.toThrow("stale_preview");
    expect(scalar(sqlite, "SELECT address FROM site WHERE id = ?", [owner.site.id])).toBe("kept");
    expect(auditActions(sqlite)).toEqual([]);
  });

  it("does not run a string that merely contains DROP, and insert executes only after confirm", async () => {
    const { sqlite, runner } = await openMemoryDb();
    const update = await opsPreviewSql(runner, {
      sql: "UPDATE site SET address = 'DROP TABLE site' WHERE id = ?",
      params: ["missing"],
      secret: SECRET,
      nowMs: 1_000,
    });
    expect(update).toMatchObject({ kind: "dry_run", rowCount: 0 });
    expect(scalar(sqlite, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'site'")).toBe("site");

    const sql = "INSERT INTO rate_limit (id, key, count, last_request) VALUES (?, ?, ?, ?)";
    const params: SqlValue[] = ["rl-1", "ops", 1, 1];
    const preview = await opsPreviewSql(runner, { sql, params, secret: SECRET, nowMs: 1_000 });
    expect(preview).toMatchObject({ kind: "dry_run", rowCount: 1 });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM rate_limit")).toBe(0);
    if (preview.kind !== "dry_run") throw new Error("expected dry run");
    await opsExecuteSql(runner, { sql, params, confirmToken: preview.confirmToken, reason: "Seed a limit row", secret: SECRET, nowMs: 1_000 });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM rate_limit")).toBe(1);
    expect(auditActions(sqlite).map((row) => row.action)).toEqual(["sql.insert"]);
  });

  it("keeps ops_audit append-only", async () => {
    const { sqlite, database } = await openMemoryDb();
    seedOwnerWorkspace(sqlite, "owner-a");
    await opsCreateContractor(database, {
      ownerUserId: "owner-a",
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      reason: "Add contractor",
    });
    const id = scalar(sqlite, "SELECT id FROM ops_audit LIMIT 1");
    if (typeof id !== "string") throw new Error("missing audit id");
    expect(() => sqlite.run("UPDATE ops_audit SET reason = 'changed' WHERE id = ?", [id])).toThrow(/ops_audit_append_only/);
    expect(() => sqlite.run("DELETE FROM ops_audit")).toThrow(/ops_audit_append_only/);
    expect(scalar(sqlite, "SELECT reason FROM ops_audit WHERE id = ?", [id as string])).toBe("Add contractor");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM ops_audit")).toBe(1);
  });
});

describe("ops contractor, time entry, and wage actions", () => {
  it("archives without deleting, keeps historical rates, and reverts a rate change", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    const first = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "",
    });
    expect(first.rateCents).toBe(3_000);

    const rated = await opsChangeContractorRate(database, owner.contractor.id, {
      ownerUserId: "owner-a",
      defaultRateCents: 4_500,
      reason: "New default rate",
    });
    expect(rated.contractor.defaultRateCents).toBe(4_500);
    expect(scalar(sqlite, "SELECT rate_cents FROM time_entry WHERE id = ?", [first.id])).toBe(3_000);

    const second = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: "2026-09-01",
      paidMinutes: 60,
      notes: "",
    });
    expect(second.rateCents).toBe(4_500);

    const reverted = await opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: rated.auditId,
      reason: "Undo the rate change",
    });
    expect(reverted).toMatchObject({ action: "contractor.rate", contractor: { defaultRateCents: 3_000 } });
    expect(scalar(sqlite, "SELECT default_rate_cents FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(3_000);
    expect(scalar(sqlite, "SELECT rate_cents FROM time_entry WHERE id = ?", [first.id])).toBe(3_000);
    expect(scalar(sqlite, "SELECT rate_cents FROM time_entry WHERE id = ?", [second.id])).toBe(4_500);
    await expect(opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: rated.auditId,
      reason: "Undo again",
    })).rejects.toThrow("already_reverted");

    await opsArchiveContractor(database, owner.contractor.id, { ownerUserId: "owner-a", reason: "Left the team" });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(1);
    expect(scalar(sqlite, "SELECT active FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(0);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(0);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM time_entry WHERE contractor_id = ?", [owner.contractor.id])).toBe(2);

    seedOwnerWorkspace(sqlite, "owner-b");
    await expect(opsUpdateContractor(database, owner.contractor.id, {
      ownerUserId: "owner-b",
      name: "Other",
      email: "",
      phone: "",
      reason: "Wrong owner",
    })).rejects.toThrow("not_found");
  });

  it("requires confirm on an approved week and flags a day over 14 hours", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    const entry = {
      ownerUserId: "owner-a",
      reason: "Record the shift",
      entryMode: "paid_hours" as const,
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "",
    };
    const created = await opsCreateTimeEntry(database, entry);
    expect(created.longDay).toBe(false);
    expect(created.dayPaidMinutes).toBe(480);
    await approveWeek(database, "owner-a", { weekStart: "2026-08-31", expectedPaidMinutes: 480, expectedPayCents: 24_000 });

    await expect(opsCreateTimeEntry(database, { ...entry, workDate: "2026-09-01", paidMinutes: 60 })).rejects.toThrow("week_locked");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM time_entry")).toBe(1);

    const confirmed = await opsCreateTimeEntry(database, {
      ...entry,
      workDate: "2026-09-01",
      paidMinutes: 60,
      confirmLockedWeek: true,
      reason: "Approved-week correction",
    });
    expect(confirmed.entry.paidMinutes).toBe(60);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM time_entry")).toBe(2);

    const longDay = await opsCreateTimeEntry(database, {
      ...entry,
      siteId: owner.otherSite.id,
      workDate: "2026-09-02",
      paidMinutes: LONG_DAY_MINUTES + 1,
      confirmLockedWeek: true,
      reason: "Long shift",
    });
    expect(longDay.longDay).toBe(true);
    expect(longDay.dayPaidMinutes).toBe(LONG_DAY_MINUTES + 1);

    const exact = await opsCreateTimeEntry(database, {
      ...entry,
      siteId: owner.otherSite.id,
      workDate: "2026-09-03",
      paidMinutes: LONG_DAY_MINUTES,
      confirmLockedWeek: true,
      reason: "Fourteen hours",
    });
    expect(exact.longDay).toBe(false);

    const removed = await opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: confirmed.auditId,
      reason: "Remove the correction",
      confirmLockedWeek: true,
    });
    expect(removed).toMatchObject({ action: "time_entry.create", deletedEntryId: confirmed.entry.id });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM time_entry WHERE id = ?", [confirmed.entry.id])).toBe(0);
  });

  it("matches payroll totals for the contractor, site, and week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    await seedWorkspace(database, sqlite, "owner-b");
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "",
    });
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.otherSite.id,
      workDate: "2026-09-01",
      paidMinutes: 60,
      notes: "",
    });
    const entries = [
      { contractorId: owner.contractor.id, contractorName: "owner-a-aroha", siteId: owner.site.id, siteName: "owner-a-harbour", paidMinutes: 480, rateCents: 3_000 },
      { contractorId: owner.contractor.id, contractorName: "owner-a-aroha", siteId: owner.otherSite.id, siteName: "owner-a-warehouse", paidMinutes: 60, rateCents: 2_800 },
    ];
    const wages = await opsWages(database, { ownerUserId: "owner-a", weekStart: "2026-08-31" });
    expect(wages.contractors).toEqual(summarizeWeek(entries));
    expect(wages.sites).toEqual(summarizeWeekBySite(entries));
    expect(wages.totals).toEqual(weekPayrollTotals(entries));
    expect(wages.totals).toEqual({ currentPaidMinutes: 540, currentPayCents: 24_000 + 2_800 });

    const harbour = entries.filter((entry) => entry.siteId === owner.site.id);
    const bySite = await opsWages(database, { ownerUserId: "owner-a", weekStart: "2026-08-31", siteId: owner.site.id });
    expect(bySite.totals).toEqual(weekPayrollTotals(harbour));
    expect(bySite.contractors).toEqual(summarizeWeek(harbour));

    const other = await opsWages(database, { ownerUserId: "owner-b", weekStart: "2026-08-31" });
    expect(other.totals).toEqual({ currentPaidMinutes: 0, currentPayCents: 0 });
    expect(other.contractors).toEqual([]);
  });

  it("omits notes, emergency contact, and GST number from ops contractor responses", async () => {
    const { sqlite, database } = await openMemoryDb();
    seedOwnerWorkspace(sqlite, "owner-a");
    const created = await opsCreateContractor(database, {
      ownerUserId: "owner-a",
      name: "Aroha",
      email: "aroha@example.test",
      phone: "021000000",
      defaultRateCents: 3_000,
      reason: "Add contractor",
      gstRegistered: true,
      gstNumber: "123456789",
      internalNotes: "Key holder",
      emergencyContactName: "Sam",
      emergencyContactPhone: "021111111",
    });
    expect(Object.keys(created.contractor).sort()).toEqual([
      "active",
      "currency",
      "defaultRateCents",
      "email",
      "engagementStatus",
      "id",
      "name",
      "phone",
    ]);
    expect(JSON.stringify(created)).not.toMatch(/Key holder|021111111|123456789/);
    const audit = scalar(sqlite, "SELECT new_json FROM ops_audit WHERE action = 'contractor.create'");
    expect(String(audit)).not.toMatch(/Key holder|021111111|123456789|internalNotes|emergencyContact/);

    const updated = await opsUpdateContractor(database, created.contractor.id, {
      ownerUserId: "owner-a",
      name: "Aroha North",
      email: "aroha@example.test",
      phone: "021000000",
      reason: "Correct the name",
    });
    const archived = await opsArchiveContractor(database, created.contractor.id, { ownerUserId: "owner-a", reason: "Pause" });
    const restored = await opsRestoreContractor(database, created.contractor.id, { ownerUserId: "owner-a", reason: "Return" });
    for (const body of [updated.contractor, archived.contractor, restored.contractor]) {
      expect(body).not.toHaveProperty("internalNotes");
      expect(body).not.toHaveProperty("emergencyContactName");
      expect(body).not.toHaveProperty("emergencyContactPhone");
      expect(body).not.toHaveProperty("gstNumber");
    }
  });

  it("undoes archive and restore to the saved engagement status", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    await updateContractor(database, "owner-a", owner.contractor.id, {
      name: owner.contractor.name,
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      engagementStatus: "suspended",
    });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(2);

    const archived = await opsArchiveContractor(database, owner.contractor.id, { ownerUserId: "owner-a", reason: "Leave" });
    expect(archived.contractor).toMatchObject({ engagementStatus: "archived", active: false });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(0);

    await updateContractor(database, "owner-a", owner.contractor.id, {
      name: owner.contractor.name,
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      engagementStatus: "suspended",
    });
    await expect(opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: archived.auditId,
      reason: "Undo after the owner changed status",
    })).rejects.toThrow("stale_preview");
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id = ?", [owner.contractor.id])).toBe("suspended");
    expect(scalar(sqlite, "SELECT active FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(0);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(0);

    const archivedAgain = await opsArchiveContractor(database, owner.contractor.id, { ownerUserId: "owner-a", reason: "Leave again" });
    const undone = await opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: archivedAgain.auditId,
      reason: "Undo the archive",
    });
    expect(undone).toMatchObject({ contractor: { engagementStatus: "suspended", active: false } });
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id = ?", [owner.contractor.id])).toBe("suspended");
    expect(scalar(sqlite, "SELECT active FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(0);
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(0);

    const restored = await opsRestoreContractor(database, owner.contractor.id, { ownerUserId: "owner-a", reason: "Bring back" });
    expect(restored.contractor).toMatchObject({ engagementStatus: "active", active: true });
    const undoRestore = await opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: restored.auditId,
      reason: "Undo the restore",
    });
    expect(undoRestore).toMatchObject({ contractor: { engagementStatus: "suspended", active: false } });
  });

  it("reactivates assignments when undoing an archive back to active", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    const archived = await opsArchiveContractor(database, owner.contractor.id, { ownerUserId: "owner-a", reason: "Leave" });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(0);
    const undone = await opsRevert(database, {
      ownerUserId: "owner-a",
      auditId: archived.auditId,
      reason: "Undo the archive",
    });
    expect(undone).toMatchObject({ contractor: { engagementStatus: "active", active: true } });
    expect(scalar(sqlite, "SELECT COUNT(*) FROM assignment WHERE contractor_id = ? AND active = 1", [owner.contractor.id])).toBe(2);
  });

  it("rejects a direct contractor active update before the dry run writes", async () => {
    const { sqlite, database, runner } = await openMemoryDb();
    const owner = await seedWorkspace(database, sqlite, "owner-a");
    await expect(opsPreviewSql(runner, {
      sql: "UPDATE contractor SET active = 0 WHERE id = ?",
      params: [owner.contractor.id],
      secret: SECRET,
      nowMs: 1_000,
    })).rejects.toThrow("forbidden_sql");
    expect(scalar(sqlite, "SELECT active FROM contractor WHERE id = ?", [owner.contractor.id])).toBe(1);
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id = ?", [owner.contractor.id])).toBe("active");
    expect(auditActions(sqlite)).toEqual([]);
  });
});
