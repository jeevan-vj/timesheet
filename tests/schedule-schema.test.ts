import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignmentScheduleVersions, timeEntries } from "../src/db/schema";

const APPLIED_0001 = "ALTER TABLE `time_entry` ADD `entry_mode` text DEFAULT 'clock' NOT NULL;";
const APPLIED_0002 = `CREATE TABLE \`week_approval\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`owner_user_id\` text NOT NULL,
  \`created_at\` integer NOT NULL,
  \`updated_at\` integer NOT NULL,
  \`week_start\` text NOT NULL,
  \`status\` text NOT NULL,
  \`approved_at\` integer NOT NULL,
  \`reopened_at\` integer,
  FOREIGN KEY (\`owner_user_id\`) REFERENCES \`user\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX \`week_approval_owner_week_uq\` ON \`week_approval\` (\`owner_user_id\`,\`week_start\`);`;

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8"));
  return { sqlite };
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
    [id, id, `${id}@example.test`],
  );
}

function insertSiteContractorAssignment(
  sqlite: SqlJsDatabase,
  ids: { ownerUserId: string; siteId: string; contractorId: string; assignmentId: string },
) {
  sqlite.run(
    "INSERT INTO site (id, owner_user_id, created_at, updated_at, name, address, active) VALUES (?, ?, 1700000000, 1700000000, ?, '', 1)",
    [ids.siteId, ids.ownerUserId, ids.siteId],
  );
  sqlite.run(
    "INSERT INTO contractor (id, owner_user_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active) VALUES (?, ?, 1700000000, 1700000000, ?, '', '', 3000, 'NZD', 1)",
    [ids.contractorId, ids.ownerUserId, ids.contractorId],
  );
  sqlite.run(
    "INSERT INTO assignment (id, owner_user_id, created_at, updated_at, contractor_id, site_id, rate_cents, active) VALUES (?, ?, 1700000000, 1700000000, ?, ?, 3200, 1)",
    [ids.assignmentId, ids.ownerUserId, ids.contractorId, ids.siteId],
  );
}

function tableNames(sqlite: SqlJsDatabase) {
  return sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]?.values.map((row) => row[0]) ?? [];
}

function indexNames(sqlite: SqlJsDatabase) {
  return sqlite.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND name IS NOT NULL ORDER BY name")[0]?.values.map((row) => row[0]) ?? [];
}

function columnInfo(sqlite: SqlJsDatabase, table: string) {
  return sqlite.exec(`PRAGMA table_info(${table})`)[0];
}

describe("recurring schedule schema", () => {
  it("creates assignment_schedule_version and the owner/assignment indexes", async () => {
    const { sqlite } = await openMemoryDb();
    expect(tableNames(sqlite)).toContain("assignment_schedule_version");
    const indexes = indexNames(sqlite);
    expect(indexes).toContain("assignment_schedule_version_owner_idx");
    expect(indexes).toContain("assignment_schedule_version_assignment_idx");

    const config = getTableConfig(assignmentScheduleVersions);
    expect(config.indexes.map((index) => index.config.name)).toEqual([
      "assignment_schedule_version_owner_idx",
      "assignment_schedule_version_assignment_idx",
    ]);
    expect(config.indexes.every((index) => index.config.unique !== true)).toBe(true);
    expect(config.checks).toHaveLength(0);
  });

  it("adds occurrence_kind and schedule_version_id; existing inserts default occurrence_kind to manual", async () => {
    const { sqlite } = await openMemoryDb();
    const columns = columnInfo(sqlite, "time_entry");
    const names = columns?.values.map((row) => row[1]) ?? [];
    expect(names).toContain("occurrence_kind");
    expect(names).toContain("schedule_version_id");

    insertUser(sqlite, "owner-a");
    insertSiteContractorAssignment(sqlite, {
      ownerUserId: "owner-a",
      siteId: "site-a",
      contractorId: "contractor-a",
      assignmentId: "assignment-a",
    });
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-a', 'owner-a', 1700000000, 1700000000, 'contractor-a', 'site-a', '2026-08-31', 0, 90, 0, 90, 3200, '')",
    );
    const row = sqlite.exec("SELECT occurrence_kind, schedule_version_id, entry_mode FROM time_entry WHERE id = 'entry-a'")[0]?.values[0];
    expect(row).toEqual(["manual", null, "clock"]);

    const uniqueNames = getTableConfig(timeEntries).indexes.filter((index) => index.config.unique).map((index) => index.config.name);
    expect(uniqueNames).toEqual(["time_entry_owner_contractor_site_date_uq"]);
  });

  it("leaves applied migrations 0000, 0001, and 0002 unchanged", () => {
    expect(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8")).toMatch(/^PRAGMA foreign_keys=ON;/);
    expect(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8").trim()).toBe(APPLIED_0001);
    expect(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8").trim()).toBe(APPLIED_0002);
  });

  it("adds 0003 without CHECK, DROP, or INSERT", () => {
    const migration = fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8");
    expect(migration).not.toMatch(/CHECK/i);
    expect(migration).not.toMatch(/\bDROP\b/);
    expect(migration).not.toMatch(/\bINSERT\b/);
    expect(migration).toContain("CREATE TABLE `assignment_schedule_version`");
    expect(migration).toContain("ALTER TABLE `time_entry` ADD `occurrence_kind`");
    expect(migration).toContain("ALTER TABLE `time_entry` ADD `schedule_version_id`");
  });

  it("lets two owners store versions for their own assignments", async () => {
    const { sqlite } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertUser(sqlite, "owner-b");
    insertSiteContractorAssignment(sqlite, {
      ownerUserId: "owner-a",
      siteId: "site-a",
      contractorId: "contractor-a",
      assignmentId: "assignment-a",
    });
    insertSiteContractorAssignment(sqlite, {
      ownerUserId: "owner-b",
      siteId: "site-b",
      contractorId: "contractor-b",
      assignmentId: "assignment-b",
    });
    sqlite.run(
      "INSERT INTO assignment_schedule_version (id, owner_user_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at) VALUES ('ver-a', 'owner-a', 'assignment-a', 31, 90, '2026-08-31', NULL, 1700000000, 1700000000)",
    );
    sqlite.run(
      "INSERT INTO assignment_schedule_version (id, owner_user_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at) VALUES ('ver-b', 'owner-b', 'assignment-b', 31, 90, '2026-08-31', NULL, 1700000000, 1700000000)",
    );
    const owners = sqlite.exec("SELECT owner_user_id FROM assignment_schedule_version ORDER BY owner_user_id")[0]?.values.map((row) => row[0]);
    expect(owners).toEqual(["owner-a", "owner-b"]);
  });
});
