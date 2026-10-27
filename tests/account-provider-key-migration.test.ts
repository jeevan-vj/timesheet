import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { drizzle } from "drizzle-orm/sql-js";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { account } from "../src/db/schema";
import { createAuth } from "../src/lib/auth-options";
import { trustedOriginsFor } from "../src/lib/accounts-config";
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

const BASE_URL = "https://app.example.test";
const PASSWORD = "test-password-12";
const STORED_ISSUER = "https://issuer.example";
const ACCOUNT_ROW = `SELECT id, user_id, issuer, account_id, provider_id, access_token, refresh_token,
  access_token_expires_at, refresh_token_expires_at, scope, id_token, password, created_at, updated_at
  FROM account WHERE id = 'acc-1'`;

function migrationSql(name: string) {
  return fs.readFileSync(path.resolve("drizzle", name), "utf8");
}

function rows(sqlite: SqlJsDatabase, sql: string) {
  return sqlite.exec(sql)[0]?.values ?? [];
}

describe("account provider key migration", () => {
  it("keeps a 1.7.2 credential row, signs in on 1.7.13, and defaults new issuers", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of PRIOR) sqlite.exec(migrationSql(name));
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Owner A", email: "owner-a@example.test" });
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
    const passwordHash = await hashPassword(PASSWORD);
    sqlite.run(
      `INSERT INTO account (
        id, user_id, issuer, account_id, provider_id, access_token, refresh_token,
        access_token_expires_at, refresh_token_expires_at, scope, id_token, password, created_at, updated_at
      ) VALUES (
        'acc-1', 'owner-a', ?, 'owner-a', 'credential', 'access-token', 'refresh-token',
        1700001111, 1700002222, 'openid', 'id-token', ?, 1700000000, 1700003333
      )`,
      [STORED_ISSUER, passwordHash],
    );
    const before = rows(sqlite, ACCOUNT_ROW);

    sqlite.exec(migrationSql("0008_account_provider_key.sql"));

    expect(rows(sqlite, ACCOUNT_ROW)).toEqual(before);
    expect(rows(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-a'")).toEqual([[3200, 90]]);
    const issuerColumn = rows(sqlite, "PRAGMA table_info(account)").find((column) => column[1] === "issuer");
    expect(issuerColumn?.[3]).toBe(0);
    expect(String(issuerColumn?.[4])).toContain("local:credential");
    expect(rows(sqlite, "PRAGMA foreign_key_list(account)")).toEqual([
      [0, 0, "user", "user_id", "id", "NO ACTION", "CASCADE", "NONE"],
    ]);
    expect(rows(sqlite, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'account' AND name NOT LIKE 'sqlite_autoindex_%' ORDER BY name")).toEqual([
      ["account_provider_id_account_id_uq"],
      ["account_user_id_idx"],
    ]);
    expect(migrationSql("0008_account_provider_key.sql")).not.toMatch(/DROP COLUMN/i);
    expect(migrationSql("0000_initial.sql")).toContain("issuer");
    const mappedIssuer = getTableConfig(account).columns.find((column) => column.name === "issuer");
    expect(mappedIssuer?.notNull).toBe(false);
    expect(mappedIssuer?.hasDefault).toBe(true);
    expect(String(mappedIssuer?.default)).toContain("local:credential");
    expect(getTableConfig(account).indexes.map((index) => index.config.name)).toEqual([
      "account_user_id_idx",
      "account_provider_id_account_id_uq",
    ]);

    const auth = createAuth({
      secret: "test-secret-test-secret-test-secret",
      baseURL: BASE_URL,
      db: drizzle(sqlite),
      trustedOrigins: trustedOriginsFor(BASE_URL),
      secureCookies: true,
    });
    const signedIn = await auth.handler(new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "cf-connecting-ip": "203.0.113.20" },
      body: JSON.stringify({ email: "owner-a@example.test", password: PASSWORD }),
    }));
    expect(signedIn.status).toBe(200);

    const signedUp = await auth.handler(new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL, "cf-connecting-ip": "203.0.113.21" },
      body: JSON.stringify({ name: "New Owner", email: "new-owner@example.test", password: PASSWORD }),
    }));
    expect(signedUp.status).toBe(200);
    expect(rows(sqlite, "SELECT issuer FROM account WHERE id = 'acc-1'")).toEqual([[STORED_ISSUER]]);
    expect(rows(sqlite, "SELECT issuer FROM account INNER JOIN user ON user.id = account.user_id WHERE user.email = 'new-owner@example.test'")).toEqual([
      ["local:credential"],
    ]);
    expect(rows(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-a'")).toEqual([[3200, 90]]);

    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-b', 'User B', 'user-b@example.test', 0, 1700000000, 1700000000)",
    );
    sqlite.run(
      "INSERT INTO account (id, user_id, account_id, provider_id, created_at, updated_at) VALUES ('acc-b', 'user-b', 'user-b', 'credential', 1700000000, 1700000000)",
    );
    expect(rows(sqlite, "SELECT issuer FROM account WHERE id = 'acc-b'")).toEqual([["local:credential"]]);
    sqlite.run("DELETE FROM user WHERE id = 'user-b'");
    expect(rows(sqlite, "SELECT COUNT(*) FROM account WHERE id = 'acc-b'")).toEqual([[0]]);
    expect(rows(sqlite, "SELECT issuer, password FROM account WHERE id = 'acc-1'")).toEqual([[STORED_ISSUER, passwordHash]]);
  });
});
