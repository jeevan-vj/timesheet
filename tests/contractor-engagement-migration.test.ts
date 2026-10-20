import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase, type StatementIterator } from "sql.js";
import { describe, expect, it } from "vitest";
import { contractors } from "../src/db/schema";
import { seedOwnerWorkspace } from "./owner-workspace";

const PRIOR_MIGRATIONS = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
  "0005_ops_audit.sql",
] as const;

function migrationSql(name: string) {
  return fs.readFileSync(path.resolve("drizzle", name), "utf8");
}

async function openSql() {
  const SQL = await initSqlJs();
  return new SQL.Database();
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function reapplyMigration(sqlite: SqlJsDatabase, sql: string) {
  let remaining = sql;
  while (remaining.trim() !== "") {
    const iterator: StatementIterator = sqlite.iterateStatements(remaining);
    try {
      for (const statement of iterator) {
        try {
          while (statement.step()) {
            // Migration statements are DDL or writes.
          }
        } finally {
          statement.free();
        }
      }
      return;
    } catch (error) {
      const message = errorText(error);
      if (!message.includes("duplicate column name")) throw error;
      const tail = iterator.getRemainingSQL();
      const semicolon = tail.indexOf(";");
      if (semicolon < 0) throw error;
      const next = tail.slice(semicolon + 1);
      if (next.trim() === remaining.trim()) throw error;
      remaining = next;
    }
  }
}

function query(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []) {
  const statement = sqlite.prepare(sql);
  statement.bind(params);
  const rows: unknown[][] = [];
  while (statement.step()) rows.push(statement.get());
  statement.free();
  return rows;
}

function applyPrior(sqlite: SqlJsDatabase) {
  for (const name of PRIOR_MIGRATIONS) sqlite.exec(migrationSql(name));
}

function seedContractor(sqlite: SqlJsDatabase, id: string, ownerUserId: string, active: number, rateCents: number) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, '', '', ?, 'NZD', ?)`,
    [id, ownerUserId, `biz_${ownerUserId}`, id, rateCents, active],
  );
}

describe("contractor engagement migration", () => {
  it("maps active contractors to active and inactive contractors to archived without rewriting pay", async () => {
    const sqlite = await openSql();
    applyPrior(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    seedContractor(sqlite, "working", "owner-a", 1, 3_200);
    seedContractor(sqlite, "former", "owner-a", 0, 2_800);
    sqlite.run(
      "INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active) VALUES ('site-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Harbour', '', 1)",
    );
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'working', 'site-a', '2026-08-31', 480, 570, 0, 90, 3200, '')",
    );

    sqlite.exec(migrationSql("0006_contractor_engagement.sql"));

    expect(query(sqlite, "SELECT id, active, engagement_status, preferred_name, start_date, gst_registered, gst_number FROM contractor ORDER BY id")).toEqual([
      ["former", 0, "archived", "", null, 0, ""],
      ["working", 1, "active", "", null, 0, ""],
    ]);
    expect(query(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-a'")).toEqual([[3_200, 90]]);

    sqlite.run("UPDATE contractor SET engagement_status = 'suspended', active = 0 WHERE id = 'working'");
    reapplyMigration(sqlite, migrationSql("0006_contractor_engagement.sql"));
    expect(query(sqlite, "SELECT id, engagement_status, active FROM contractor ORDER BY id")).toEqual([
      ["former", "archived", 0],
      ["working", "suspended", 0],
    ]);
    expect(query(sqlite, "SELECT rate_cents FROM time_entry WHERE id = 'entry-a'")).toEqual([[3_200]]);
  });

  it("rejects an unknown or mismatched status and aligns an active-only update", async () => {
    const sqlite = await openSql();
    applyPrior(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.exec(migrationSql("0006_contractor_engagement.sql"));

    expect(() => sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
      ) VALUES ('bad-status', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Bad', '', '', 3000, 'NZD', 1, 'fired')`,
    )).toThrow(/invalid_engagement_status/);

    expect(() => sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
      ) VALUES ('bad-flag', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Flag', '', '', 3000, 'NZD', 1, 'suspended')`,
    )).toThrow(/engagement_active_mismatch/);

    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
      ) VALUES ('drafted', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Drafted', '', '', 3000, 'NZD', 0, 'draft')`,
    );
    sqlite.run("UPDATE contractor SET active = 1 WHERE id = 'drafted'");
    expect(query(sqlite, "SELECT engagement_status, active FROM contractor WHERE id = 'drafted'")).toEqual([["active", 1]]);
    expect(() => sqlite.run("UPDATE contractor SET engagement_status = 'suspended' WHERE id = 'drafted'")).toThrow(/engagement_active_mismatch/);
    sqlite.run("UPDATE contractor SET engagement_status = 'suspended', active = 0 WHERE id = 'drafted'");
    expect(query(sqlite, "SELECT engagement_status, active FROM contractor WHERE id = 'drafted'")).toEqual([["suspended", 0]]);
    sqlite.run("UPDATE contractor SET active = 1 WHERE id = 'drafted'");
    expect(query(sqlite, "SELECT engagement_status, active FROM contractor WHERE id = 'drafted'")).toEqual([["active", 1]]);
    sqlite.run("UPDATE contractor SET active = 0 WHERE id = 'drafted'");
    expect(query(sqlite, "SELECT engagement_status, active FROM contractor WHERE id = 'drafted'")).toEqual([["archived", 0]]);
  });

  it("leaves migrations 0000 through 0005 unchanged and declares the engagement columns", () => {
    for (const name of PRIOR_MIGRATIONS) {
      expect(migrationSql(name)).not.toMatch(/engagement_status/);
      expect(migrationSql(name)).not.toMatch(/preferred_name/);
    }
    const config = getTableConfig(contractors);
    const names = config.columns.map((column) => column.name);
    expect(names).toEqual(expect.arrayContaining([
      "preferred_name",
      "start_date",
      "engagement_status",
      "gst_registered",
      "gst_number",
      "internal_notes",
      "emergency_contact_name",
      "emergency_contact_phone",
    ]));
    expect(contractors.engagementStatus.notNull).toBe(true);
    expect(contractors.startDate.notNull).toBe(false);
  });
});
