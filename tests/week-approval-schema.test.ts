import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { weekApprovals } from "../src/db/schema";
import { businessIdForUser } from "../src/lib/business";
import { seedOwnerWorkspace } from "./owner-workspace";
import { isUniqueConstraintError } from "../src/lib/db-errors";
import { findWeekApproval } from "../src/lib/week-approval-query";

type WeekApprovalDb = Parameters<typeof findWeekApproval>[0];

const MONDAY = "2026-08-31";

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0004_business_workspace.sql"), "utf8"));
  const database = drizzle(sqlite) as unknown as WeekApprovalDb;
  return { sqlite, database };
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  seedOwnerWorkspace(sqlite, id);
}

function insertWeekApproval(
  sqlite: SqlJsDatabase,
  row: { id: string; ownerUserId: string; weekStart: string; status?: "approved" | "reopened"; reopenedAt?: number | null },
) {
  sqlite.run(
    "INSERT INTO week_approval (id, owner_user_id, business_id, created_at, updated_at, week_start, status, approved_at, reopened_at) VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, 1700000000, ?)",
    [row.id, row.ownerUserId, businessIdForUser(row.ownerUserId), row.weekStart, row.status ?? "approved", row.reopenedAt ?? null],
  );
}

describe("week approval schema and owner-scoped lookup", () => {
  it("returns null when no row exists so the week stays Open by default", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");

    expect(await findWeekApproval(database, "owner-a", MONDAY, businessIdForUser("owner-a"))).toBeNull();
  });

  it("finds the owner week row and treats the same Monday as a different row for another owner", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertUser(sqlite, "owner-b");
    insertWeekApproval(sqlite, { id: "wa-a", ownerUserId: "owner-a", weekStart: MONDAY });
    insertWeekApproval(sqlite, { id: "wa-b", ownerUserId: "owner-b", weekStart: MONDAY });

    const owned = await findWeekApproval(database, "owner-a", MONDAY, businessIdForUser("owner-a"));
    expect(owned).toMatchObject({
      id: "wa-a",
      ownerUserId: "owner-a",
      weekStart: MONDAY,
      status: "approved",
      reopenedAt: null,
    });
    expect(owned?.approvedAt).toBeInstanceOf(Date);

    const other = await findWeekApproval(database, "owner-b", MONDAY, businessIdForUser("owner-b"));
    expect(other).toMatchObject({
      id: "wa-b",
      ownerUserId: "owner-b",
      weekStart: MONDAY,
    });
    expect(other?.id).not.toBe(owned?.id);
  });

  it("rejects a second insert for the same owner and week_start", async () => {
    const { sqlite } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertWeekApproval(sqlite, { id: "wa-a", ownerUserId: "owner-a", weekStart: MONDAY });

    let duplicateError: unknown;
    try {
      insertWeekApproval(sqlite, { id: "wa-dup", ownerUserId: "owner-a", weekStart: MONDAY });
    } catch (error) {
      duplicateError = error;
    }
    expect(duplicateError).toBeDefined();
    expect(isUniqueConstraintError(duplicateError)).toBe(true);
  });

  it("does not return another owner's row for the same Monday", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    insertUser(sqlite, "owner-b");
    insertWeekApproval(sqlite, { id: "wa-a", ownerUserId: "owner-a", weekStart: MONDAY });

    expect(await findWeekApproval(database, "owner-b", MONDAY, businessIdForUser("owner-b"))).toBeNull();
  });

  it("stores no rate, pay, or minutes columns and only the owner/week unique index", () => {
    const migration = fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8");
    expect(migration).not.toMatch(/rate_cents|pay_cents|paid_minutes/);
    expect(migration).not.toMatch(/CHECK/i);
    expect(migration).not.toMatch(/\bDROP\b/);
    expect(migration).not.toMatch(/\bINSERT\b/);
    expect(migration).toContain("CREATE UNIQUE INDEX `week_approval_owner_week_uq`");
    expect(migration.match(/CREATE(?: UNIQUE)? INDEX/g)).toHaveLength(1);

    const config = getTableConfig(weekApprovals);
    expect(config.indexes).toHaveLength(1);
    expect(config.indexes[0]?.config.name).toBe("week_approval_owner_week_uq");
    expect(config.indexes[0]?.config.unique).toBe(true);
    expect(config.checks).toHaveLength(0);
  });

  it("leaves applied migrations 0000, 0001, and 0002 unchanged", () => {
    expect(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8")).toMatch(/^PRAGMA foreign_keys=ON;/);
    expect(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8").trim()).toBe(
      "ALTER TABLE `time_entry` ADD `entry_mode` text DEFAULT 'clock' NOT NULL;",
    );
    expect(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8").trim()).toBe(
      `CREATE TABLE \`week_approval\` (
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
CREATE UNIQUE INDEX \`week_approval_owner_week_uq\` ON \`week_approval\` (\`owner_user_id\`,\`week_start\`);`,
    );
  });
});
