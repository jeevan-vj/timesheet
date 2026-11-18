import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";

describe("contractor submission reason migration", () => {
  it("adds an empty reason without rewriting historical minutes or rates", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of [
      "0000_initial.sql",
      "0001_entry_mode.sql",
      "0002_week_approval.sql",
      "0003_recurring_schedules.sql",
      "0004_business_workspace.sql",
      "0005_ops_audit.sql",
      "0006_contractor_engagement.sql",
      "0007_contractor_portal_access.sql",
      "0008_account_provider_key.sql",
      "0009_owner_time_entry_audit.sql",
      "0010_owner_assistant_confirmation.sql",
      "0011_pay_rules.sql",
    ]) sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run(
      `INSERT INTO site (id, owner_user_id, business_id, created_at, updated_at, name, address, active)
       VALUES ('site-a', 'owner-a', 'biz_owner-a', 1, 1, 'Site A', '', 1)`,
    );
    sqlite.run(
      `INSERT INTO contractor (id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active)
       VALUES ('contractor-a', 'owner-a', 'biz_owner-a', 1, 1, 'Contractor A', '', '', 2500, 'NZD', 1)`,
    );
    sqlite.run(
      `INSERT INTO time_entry
       (id, owner_user_id, business_id, created_at, updated_at, contractor_id, site_id, work_date,
        start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, entry_mode, occurrence_kind, schedule_version_id)
       VALUES ('entry-a', 'owner-a', 'biz_owner-a', 1, 1, 'contractor-a', 'site-a', '2026-10-26',
        0, 90, 0, 90, 2500, 'keep', 'paid_hours', 'scheduled', NULL)`,
    );
    const before = sqlite.exec("SELECT paid_minutes, rate_cents, notes, occurrence_kind FROM time_entry WHERE id = 'entry-a'")[0]!.values[0];

    sqlite.exec(fs.readFileSync(path.resolve("drizzle/0012_contractor_submission_reason.sql"), "utf8"));

    expect(sqlite.exec("SELECT paid_minutes, rate_cents, notes, occurrence_kind FROM time_entry WHERE id = 'entry-a'")[0]!.values[0]).toEqual(before);
    expect(sqlite.exec("SELECT submission_reason FROM time_entry WHERE id = 'entry-a'")[0]!.values[0]).toEqual([""]);
  });
});
