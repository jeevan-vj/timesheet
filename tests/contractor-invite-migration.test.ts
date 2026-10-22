import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { contractorInvites, contractorUsers } from "../src/db/schema";
import { seedOwnerWorkspace } from "./owner-workspace";

const MIGRATIONS = ["0000_initial.sql", "0001_entry_mode.sql", "0002_week_approval.sql", "0003_recurring_schedules.sql", "0004_business_workspace.sql", "0005_ops_audit.sql", "0006_contractor_engagement.sql", "0007_contractor_invites.sql"];
const sql = (name: string) => fs.readFileSync(path.resolve("drizzle", name), "utf8");

describe("contractor invite migration", () => {
  it("adds scoped invite and account-link tables without changing historical pay", async () => {
    const SQL = await initSqlJs(); const sqlite = new SQL.Database();
    for (const name of MIGRATIONS.slice(0, -1)) sqlite.exec(sql(name));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run("INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status) VALUES ('c1','owner-a','biz_owner-a',1700000000,1700000000,'Sam','sam@example.test','',3200,'NZD',1,'active')");
    sqlite.run("INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active) VALUES ('s1','owner-a','biz_owner-a',1700000000,1700000000,'Site','',1)");
    sqlite.run("INSERT INTO time_entry (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('e1','owner-a','biz_owner-a',1700000000,1700000000,'c1','s1','2026-10-19',480,540,0,60,3200,'')");
    sqlite.exec(sql("0007_contractor_invites.sql"));
    expect(sqlite.exec("SELECT paid_minutes, rate_cents FROM time_entry WHERE id='e1'")[0]?.values).toEqual([[60, 3200]]);
    expect(getTableConfig(contractorInvites).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["business_id", "owner_user_id", "contractor_id", "token_digest", "status", "expires_at", "acceptance_nonce"]));
    expect(getTableConfig(contractorUsers).columns.map((column) => column.name)).toEqual(expect.arrayContaining(["business_id", "owner_user_id", "contractor_id", "user_id"]));
  });

  it("enforces one invite per contractor, digest uniqueness, and valid states", async () => {
    const SQL = await initSqlJs(); const sqlite = new SQL.Database();
    for (const name of MIGRATIONS) sqlite.exec(sql(name));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run("INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status) VALUES ('c1','owner-a','biz_owner-a',1700000000,1700000000,'Sam','sam@example.test','',3200,'NZD',1,'active')");
    const insert = (id: string, digest: string, status = "pending") => sqlite.run("INSERT INTO contractor_invite (id, owner_user_id, business_id, contractor_id, invited_email, token_digest, status, expires_at, created_at, updated_at) VALUES (?, 'owner-a', 'biz_owner-a', 'c1', 'sam@example.test', ?, ?, 1800000000, 1700000000, 1700000000)", [id, digest, status]);
    insert("i1", "a".repeat(64));
    expect(() => insert("i2", "b".repeat(64))).toThrow(/UNIQUE/);
    expect(() => sqlite.run("UPDATE contractor_invite SET status='unknown' WHERE id='i1'")).toThrow(/invalid_invite_status/);
    expect(() => sqlite.run("UPDATE contractor_invite SET owner_user_id='other-owner' WHERE id='i1'")).toThrow(/not_found/);
  });

  it("is forward-only and leaves migrations 0000 through 0006 untouched", () => {
    for (const name of MIGRATIONS.slice(0, -1)) expect(sql(name)).not.toContain("contractor_invite");
  });
});
