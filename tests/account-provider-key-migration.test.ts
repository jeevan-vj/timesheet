import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { account } from "../src/db/schema";
import { seedOwnerWorkspace } from "./owner-workspace";

const PRIOR = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
  "0005_ops_audit.sql",
  "0006_contractor_engagement.sql",
  "0007_contractor_portal_access.sql",
] as const;

function migrationSql(name: string) {
  return fs.readFileSync(path.resolve("drizzle", name), "utf8");
}

function rows(sqlite: SqlJsDatabase, sql: string) {
  return sqlite.exec(sql)[0]?.values ?? [];
}

describe("account provider key migration", () => {
  it("drops issuer, keeps the password, and does not rewrite pay", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of PRIOR) sqlite.exec(migrationSql(name));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha', '', '', 3200, 'NZD', 1)`,
    );
    sqlite.run(
      "INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active) VALUES ('site-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Harbour', '', 1)",
    );
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'c1', 'site-a', '2026-08-31', 480, 570, 0, 90, 3200, '')",
    );
    sqlite.run(
      `INSERT INTO account (
        id, user_id, issuer, account_id, provider_id, password, created_at, updated_at
      ) VALUES ('acc-1', 'owner-a', 'https://old.example', 'owner-a', 'credential', 'stored-hash', 1700000000, 1700000000)`,
    );

    sqlite.exec(migrationSql("0008_account_provider_key.sql"));

    const columns = rows(sqlite, "PRAGMA table_info(account)").map((row) => row[1]);
    expect(columns).not.toContain("issuer");
    expect(rows(sqlite, "SELECT provider_id, account_id, password FROM account WHERE id = 'acc-1'")).toEqual([
      ["credential", "owner-a", "stored-hash"],
    ]);
    expect(rows(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-a'")).toEqual([[3200, 90]]);
    sqlite.run(
      `INSERT INTO account (
        id, user_id, account_id, provider_id, password, created_at, updated_at
      ) VALUES ('acc-2', 'owner-a', 'other', 'credential', 'stored-hash', 1700000000, 1700000000)`,
    );
    expect(() => sqlite.run(
      `INSERT INTO account (
        id, user_id, account_id, provider_id, password, created_at, updated_at
      ) VALUES ('acc-3', 'owner-a', 'owner-a', 'credential', 'stored-hash', 1700000000, 1700000000)`,
    )).toThrow(/UNIQUE constraint failed/);
    expect(migrationSql("0000_initial.sql")).toContain("issuer");
    expect(migrationSql("0008_account_provider_key.sql")).not.toMatch(/time_entry|rate_cents/);
    const wrangler = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    expect(wrangler).toContain('"AUTH_TRUSTED_ORIGINS": ""');
    expect(wrangler).not.toContain("cleantrack://");
    expect(wrangler).not.toContain("exp://");
    const indexes = getTableConfig(account).indexes.map((index) => index.config.name);
    expect(indexes).toContain("account_provider_id_account_id_uq");
    expect(indexes).not.toContain("account_issuer_account_id_uq");
    expect(getTableConfig(account).columns.map((column) => column.name)).not.toContain("issuer");
  });
});
