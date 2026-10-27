import fs from "node:fs";
import path from "node:path";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";

const PRIOR = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
  "0005_ops_audit.sql",
  "0006_contractor_engagement.sql",
] as const;

function migrationSql(name: string) {
  return fs.readFileSync(path.resolve("drizzle", name), "utf8");
}

function rows(sqlite: SqlJsDatabase, sql: string) {
  const result = sqlite.exec(sql)[0];
  return result?.values ?? [];
}

describe("contractor portal access migration", () => {
  it("adds invitation and account tables without rewriting earlier migrations or pay rows", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of PRIOR) sqlite.exec(migrationSql(name));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha', 'a@example.test', '', 3200, 'NZD', 1)`,
    );
    sqlite.run(
      "INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active) VALUES ('site-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Harbour', '', 1)",
    );
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'c1', 'site-a', '2026-08-31', 480, 570, 0, 90, 3200, '')",
    );

    sqlite.exec(migrationSql("0007_contractor_portal_access.sql"));

    expect(rows(sqlite, "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('contractor_invitation', 'contractor_account') ORDER BY name")).toEqual([
      ["contractor_account"],
      ["contractor_invitation"],
    ]);
    expect(rows(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-a'")).toEqual([[3200, 90]]);
    expect(migrationSql("0007_contractor_portal_access.sql")).not.toMatch(/\btoken\b/);
    for (const name of PRIOR) expect(migrationSql(name)).not.toContain("contractor_invitation");
    const wrangler = fs.readFileSync(path.resolve("wrangler.jsonc"), "utf8");
    expect(wrangler).not.toContain("RESEND_API_KEY");
    expect(wrangler).toContain('"MAIL_TRANSPORT": ""');
    expect(wrangler).not.toContain("smtp-dev");
  });

  it("rejects a second pending invite, a bad status, and revokes when the email changes", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of PRIOR) sqlite.exec(migrationSql(name));
    sqlite.exec(migrationSql("0007_contractor_portal_access.sql"));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO contractor (
        id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
      ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha', 'a@example.test', '', 3200, 'NZD', 1)`,
    );
    const insert = `INSERT INTO contractor_invitation (
      id, business_id, owner_user_id, contractor_id, email, token_digest, status, expires_at, send_count, last_sent_at, last_delivery, created_by_user_id, created_at, updated_at
    ) VALUES (?, 'biz_owner-a', 'owner-a', 'c1', 'a@example.test', ?, 'pending', 1700000000, 1, 1700000000, 'link_only', 'owner-a', 1700000000, 1700000000)`;
    sqlite.run(insert, ["inv-1", "a".repeat(64)]);
    expect(() => sqlite.run(insert, ["inv-2", "b".repeat(64)])).toThrow(/UNIQUE constraint failed/);
    expect(() => sqlite.run(
      `INSERT INTO contractor_invitation (
        id, business_id, owner_user_id, contractor_id, email, token_digest, status, expires_at, send_count, last_sent_at, last_delivery, created_by_user_id, created_at, updated_at
      ) VALUES ('bad', 'biz_owner-a', 'owner-a', 'c1', 'a@example.test', ?, 'sent', 1700000000, 1, 1700000000, 'link_only', 'owner-a', 1700000000, 1700000000)`,
      ["c".repeat(64)],
    )).toThrow(/invalid_invitation/);

    sqlite.run("UPDATE contractor SET email = 'b@example.test', updated_at = 1700001111 WHERE id = 'c1'");
    expect(rows(sqlite, "SELECT status, revoked_at FROM contractor_invitation WHERE id = 'inv-1'")).toEqual([["revoked", 1700001111]]);
    expect(rows(sqlite, "SELECT rate_cents FROM time_entry")).toEqual([]);
  });
});
