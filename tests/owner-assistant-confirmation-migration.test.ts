import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";

describe("owner assistant confirmation migration", () => {
  it("is forward-only and keeps confirmation receipts single-use and append-only", async () => {
    const SQL = await initSqlJs();
    const sqlite = new SQL.Database();
    for (const name of ["0000_initial.sql", "0001_entry_mode.sql", "0002_week_approval.sql", "0003_recurring_schedules.sql", "0004_business_workspace.sql"]) {
      sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
    }
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.exec(fs.readFileSync(path.resolve("drizzle/0010_owner_assistant_confirmation.sql"), "utf8"));
    sqlite.run("INSERT INTO owner_assistant_confirmation (id, owner_user_id, business_id, action, created_at) VALUES ('digest-a', 'owner-a', 'biz_owner-a', 'create_site', 1)");
    expect(() => sqlite.run("INSERT INTO owner_assistant_confirmation (id, owner_user_id, business_id, action, created_at) VALUES ('digest-a', 'owner-a', 'biz_owner-a', 'create_site', 2)")).toThrow(/UNIQUE/);
    expect(() => sqlite.run("UPDATE owner_assistant_confirmation SET action = 'assign_site' WHERE id = 'digest-a'")).toThrow(/append_only/);
    expect(() => sqlite.run("DELETE FROM owner_assistant_confirmation WHERE id = 'digest-a'")).toThrow(/append_only/);
  });
});
