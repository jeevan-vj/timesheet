import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";

describe("pay rules migration", () => {
  it("adds optional rule data while preserving historical pay bytes", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of [
      "0000_initial.sql",
      "0001_entry_mode.sql",
      "0002_week_approval.sql",
      "0003_recurring_schedules.sql",
      "0004_business_workspace.sql",
    ]) sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES ('site-a', 'owner-a', 'biz_owner-a', 1, 1, 'Site A', '', 1)`,
    );
    sqlite.run(
      `INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active)
       VALUES ('contractor-a', 'owner-a', 'biz_owner-a', 1, 1, 'Contractor A', '', '', 2345, 'NZD', 1)`,
    );
    sqlite.run(
      `INSERT INTO assignment (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, rate_cents, active)
       VALUES ('assignment-a', 'owner-a', 'biz_owner-a', 1, 1, 'contractor-a', 'site-a', NULL, 1)`,
    );
    sqlite.run(
      `INSERT INTO time_entry
       (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
        start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id)
       VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1, 1, 'contractor-a', 'site-a', '2026-10-26',
        0, 75, 0, 75, 2345, '', 'paid_hours', 'manual', NULL)`,
    );
    const before = sqlite.export();
    const beforePay = sqlite.exec("SELECT paid_minutes, rate_cents FROM time_entry WHERE id = 'entry-a'")[0]!.values[0];

    sqlite.exec(fs.readFileSync(path.resolve("drizzle/0011_pay_rules.sql"), "utf8"));

    expect(before.byteLength).toBeGreaterThan(0);
    expect(sqlite.exec("SELECT paid_minutes, rate_cents FROM time_entry WHERE id = 'entry-a'")[0]!.values[0]).toEqual(beforePay);
    expect(sqlite.exec("SELECT pay_mode, fixed_pay_cents, holiday_loading_cents, weekend_loading_cents, overnight_loading_cents FROM time_entry WHERE id = 'entry-a'")[0]!.values[0]).toEqual(["hourly", null, 0, 0, 0]);
    expect(sqlite.exec("SELECT pay_mode, fixed_pay_cents FROM assignment WHERE id = 'assignment-a'")[0]!.values[0]).toEqual(["hourly", null]);
    sqlite.run(
      `INSERT INTO business_pay_rule
       (business_id, owner_user_id, holiday_mode, holiday_multiplier_bps, use_nz_public_holidays, created_at, updated_at)
       VALUES ('biz_owner-a', 'owner-a', 'multiplier', 15000, 1, 2, 2)`,
    );
    sqlite.run(
      `INSERT INTO business_holiday
       (id, business_id, owner_user_id, holiday_date, name, created_at, updated_at)
       VALUES ('holiday-a', 'biz_owner-a', 'owner-a', '2026-10-26', 'Labour Day', 2, 2)`,
    );
    expect(() => sqlite.run(
      `INSERT INTO business_holiday
       (id, business_id, owner_user_id, holiday_date, name, created_at, updated_at)
       VALUES ('holiday-b', 'biz_owner-a', 'owner-a', '2026-10-26', 'Duplicate', 2, 2)`,
    )).toThrow(/UNIQUE/);
  });
});
