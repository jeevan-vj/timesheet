import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";

describe("owner time-entry audit migration", () => {
  it("is forward-only, preserves historical pay, and makes audit rows append-only", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of [
      "0000_initial.sql",
      "0001_entry_mode.sql",
      "0002_week_approval.sql",
      "0003_recurring_schedules.sql",
      "0004_business_workspace.sql",
    ]) {
      sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
    }
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES (?, ?, ?, ?, ?, ?, '', 1)`,
      ["site-a", "owner-a", "biz_owner-a", 1, 1, "Site A"],
    );
    sqlite.run(
      `INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active)
       VALUES (?, ?, ?, ?, ?, ?, '', '', ?, 'NZD', 1)`,
      ["contractor-a", "owner-a", "biz_owner-a", 1, 1, "Contractor A", 2_345],
    );
    sqlite.run(
      `INSERT INTO time_entry
       (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
        start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 75, 0, ?, ?, '', 'paid_hours', 'scheduled', NULL)`,
      ["entry-a", "owner-a", "biz_owner-a", 1, 1, "contractor-a", "site-a", "2026-10-26", 75, 2_345],
    );
    const before = sqlite.exec("SELECT paid_minutes, rate_cents FROM time_entry WHERE id = 'entry-a'")[0]!.values[0];

    sqlite.exec(fs.readFileSync(path.resolve("drizzle/0009_owner_time_entry_audit.sql"), "utf8"));

    expect(sqlite.exec("SELECT paid_minutes, rate_cents FROM time_entry WHERE id = 'entry-a'")[0]!.values[0]).toEqual(before);
    sqlite.run(
      `INSERT INTO owner_time_entry_audit
       (id, owner_user_id, business_id, actor_user_id, entry_id, action, old_json, new_json, created_at)
       VALUES ('audit-a', 'owner-a', 'biz_owner-a', 'owner-a', 'entry-a', 'absent', '{}', '{}', 2)`,
    );
    expect(() => sqlite.run("UPDATE owner_time_entry_audit SET action = 'worked' WHERE id = 'audit-a'")).toThrow(/append_only/);
    expect(() => sqlite.run("DELETE FROM owner_time_entry_audit WHERE id = 'audit-a'")).toThrow(/append_only/);
  });
});
