import fs from "node:fs";
import path from "node:path";
import { getTableName } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { weekApprovals } from "../src/db/schema";

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  return sqlite;
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
    [id, id, `${id}@example.test`],
  );
}

function insertApproval(
  sqlite: SqlJsDatabase,
  row: { id: string; ownerUserId: string; weekStart: string; status?: string },
) {
  sqlite.run(
    "INSERT INTO week_approval (id, owner_user_id, created_at, updated_at, week_start, status, approved_at, reopened_at) VALUES (?, ?, 1700000000, 1700000000, ?, ?, NULL, NULL)",
    [row.id, row.ownerUserId, row.weekStart, row.status ?? "open"],
  );
}

function tableColumns(sqlite: SqlJsDatabase) {
  const result = sqlite.exec("PRAGMA table_info(`week_approval`)");
  return (result[0]?.values ?? []).map((row) => ({
    name: String(row[1]),
    type: String(row[2]).toLowerCase(),
    notnull: Number(row[3]),
  }));
}

describe("week_approval schema", () => {
  it("creates week_approval with status columns and no pay or minutes columns", async () => {
    const sqlite = await openMemoryDb();
    const columns = tableColumns(sqlite);
    expect(columns.map((column) => column.name)).toEqual([
      "id",
      "owner_user_id",
      "created_at",
      "updated_at",
      "week_start",
      "status",
      "approved_at",
      "reopened_at",
    ]);
    expect(columns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["pay_cents", "paid_minutes", "rate_cents"]),
    );
    expect(columns.find((column) => column.name === "week_start")).toMatchObject({ type: "text", notnull: 1 });
    expect(columns.find((column) => column.name === "status")).toMatchObject({ type: "text", notnull: 1 });
    expect(columns.find((column) => column.name === "approved_at")).toMatchObject({ type: "integer", notnull: 0 });
    expect(columns.find((column) => column.name === "reopened_at")).toMatchObject({ type: "integer", notnull: 0 });
    expect(getTableName(weekApprovals)).toBe("week_approval");
  });

  it("rejects a second row for the same owner and week_start", async () => {
    const sqlite = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertApproval(sqlite, { id: "wa-1", ownerUserId: "owner-a", weekStart: "2026-08-31" });
    expect(() => {
      insertApproval(sqlite, { id: "wa-2", ownerUserId: "owner-a", weekStart: "2026-08-31" });
    }).toThrow(/UNIQUE/i);
  });

  it("allows different owners to share the same week_start", async () => {
    const sqlite = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertUser(sqlite, "owner-b");
    insertApproval(sqlite, { id: "wa-a", ownerUserId: "owner-a", weekStart: "2026-08-31", status: "approved" });
    insertApproval(sqlite, { id: "wa-b", ownerUserId: "owner-b", weekStart: "2026-08-31", status: "open" });
    const count = sqlite.exec("SELECT COUNT(*) FROM week_approval")[0]?.values[0]?.[0];
    expect(count).toBe(2);
  });

  it("leaves applied 0000 and 0001 migrations unchanged and free of week_approval", () => {
    const initial = fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8");
    const entryMode = fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8");
    expect(initial).toContain("PRAGMA foreign_keys=ON;");
    expect(initial).toContain("CREATE TABLE `time_entry`");
    expect(initial).toContain("CREATE UNIQUE INDEX `time_entry_owner_contractor_site_date_uq`");
    expect(initial).toContain("`rate_cents` integer NOT NULL");
    expect(initial).not.toMatch(/week_approval/);
    expect(entryMode).toContain("ALTER TABLE `time_entry` ADD `entry_mode` text DEFAULT 'clock' NOT NULL;");
    expect(entryMode).not.toMatch(/week_approval/);
    expect(entryMode).not.toMatch(/CREATE TABLE/);
  });

  it("indexes owner_user_id and unique owner/week, with FK to user", async () => {
    const sqlite = await openMemoryDb();
    const master = sqlite.exec(
      "SELECT name, type, sql FROM sqlite_master WHERE tbl_name = 'week_approval' ORDER BY name",
    )[0];
    const names = (master?.values ?? []).map((row) => String(row[0]));
    expect(names).toEqual(expect.arrayContaining([
      "week_approval",
      "week_approval_owner_idx",
      "week_approval_owner_week_uq",
    ]));
    const tableSql = String(master?.values.find((row) => row[0] === "week_approval")?.[2] ?? "");
    expect(tableSql).toContain("FOREIGN KEY (`owner_user_id`) REFERENCES `user`(`id`)");
    expect(tableSql).toMatch(/ON DELETE cascade/i);
    expect(tableSql).not.toMatch(/CHECK/i);

    const indexes = sqlite.exec("PRAGMA index_list(`week_approval`)")[0];
    const indexRows = (indexes?.values ?? []).map((row) => ({ name: String(row[1]), unique: Number(row[2]) }));
    expect(indexRows).toEqual(expect.arrayContaining([
      { name: "week_approval_owner_idx", unique: 0 },
      { name: "week_approval_owner_week_uq", unique: 1 },
    ]));

    const fks = sqlite.exec("PRAGMA foreign_key_list(`week_approval`)")[0];
    expect(fks?.values).toEqual(expect.arrayContaining([
      expect.arrayContaining(["user", "owner_user_id", "id"]),
    ]));
  });
});
