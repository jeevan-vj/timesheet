import fs from "node:fs";
import path from "node:path";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import initSqlJs, { type Database as SqlJsDatabase, type StatementIterator } from "sql.js";
import { describe, expect, it } from "vitest";
import {
  assignmentScheduleVersions,
  assignments,
  business,
  businessMember,
  contractors,
  sites,
  timeEntries,
  weekApprovals,
} from "../src/db/schema";

const MIGRATION_FILES = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
] as const;

const DOMAIN_TABLES = [
  "site",
  "contractor",
  "assignment",
  "assignment_schedule_version",
  "time_entry",
  "week_approval",
] as const;

type OwnerSeed = {
  userId: string;
  name: string;
  email: string;
  createdAt: number;
  siteId: string;
  contractorId: string;
  assignmentId: string;
  versionId: string;
  entryId: string;
  approvalId: string;
  rateCents: number;
  paidMinutes: number;
  weekStatus: "approved" | "reopened";
  approvedAt: number;
  reopenedAt: number | null;
  weekStart: string;
};

const AVERY: OwnerSeed = {
  userId: "user-avery",
  name: "Avery North",
  email: "avery.north@example.test",
  createdAt: 1_700_000_000_000,
  siteId: "site-avery",
  contractorId: "contractor-avery",
  assignmentId: "assignment-avery",
  versionId: "version-avery",
  entryId: "entry-avery",
  approvalId: "approval-avery",
  rateCents: 3250,
  paidMinutes: 95,
  weekStatus: "approved",
  approvedAt: 1_700_000_003_333,
  reopenedAt: null,
  weekStart: "2026-08-31",
};

const BLAKE: OwnerSeed = {
  userId: "user-blake",
  name: "Blake South",
  email: "blake.south@example.test",
  createdAt: 1_700_000_002_222,
  siteId: "site-blake",
  contractorId: "contractor-blake",
  assignmentId: "assignment-blake",
  versionId: "version-blake",
  entryId: "entry-blake",
  approvalId: "approval-blake",
  rateCents: 4100,
  paidMinutes: 120,
  weekStatus: "reopened",
  approvedAt: 1_700_000_004_444,
  reopenedAt: 1_700_000_005_555,
  weekStart: "2026-09-07",
};

function migrationSql(name: (typeof MIGRATION_FILES)[number]) {
  return fs.readFileSync(path.resolve("drizzle", name), "utf8");
}

async function openSql() {
  const SQL = await initSqlJs();
  return new SQL.Database();
}

function applyThrough0003(sqlite: SqlJsDatabase) {
  for (const name of MIGRATION_FILES.slice(0, 4)) sqlite.exec(migrationSql(name));
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// SQLite has no ADD COLUMN IF NOT EXISTS. A second exec stops on the first
// duplicate column, before the idempotent backfill. Skip only that error so
// the replay still runs the inserts and updates.
function reapplyMigration(sqlite: SqlJsDatabase, sql: string) {
  let remaining = sql;
  while (remaining.trim() !== "") {
    const iterator: StatementIterator = sqlite.iterateStatements(remaining);
    try {
      for (const statement of iterator) {
        try {
          while (statement.step()) {
            // Migration statements are DDL or writes.
          }
        } finally {
          statement.free();
        }
      }
      return;
    } catch (error) {
      const message = errorText(error);
      if (!message.includes("duplicate column name")) throw error;
      const tail = iterator.getRemainingSQL();
      const semicolon = tail.indexOf(";");
      if (semicolon < 0) throw error;
      const next = tail.slice(semicolon + 1);
      if (next.trim() === remaining.trim()) throw error;
      remaining = next;
    }
  }
}

function query(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []) {
  const statement = sqlite.prepare(sql);
  statement.bind(params);
  const rows: unknown[][] = [];
  while (statement.step()) rows.push(statement.get());
  statement.free();
  return rows;
}

function tableNames(sqlite: SqlJsDatabase) {
  return query(sqlite, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((row) => String(row[0]));
}

function seedUser(sqlite: SqlJsDatabase, user: Pick<OwnerSeed, "userId" | "name" | "email" | "createdAt">) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    [user.userId, user.name, user.email, user.createdAt, user.createdAt],
  );
}

function seedOwner(sqlite: SqlJsDatabase, seed: OwnerSeed) {
  seedUser(sqlite, seed);
  sqlite.run(
    "INSERT INTO site (id, owner_user_id, created_at, updated_at, name, address, active) VALUES (?, ?, ?, ?, ?, '', 1)",
    [seed.siteId, seed.userId, seed.createdAt, seed.createdAt, seed.name],
  );
  sqlite.run(
    "INSERT INTO contractor (id, owner_user_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active) VALUES (?, ?, ?, ?, ?, '', '', 3000, 'NZD', 1)",
    [seed.contractorId, seed.userId, seed.createdAt, seed.createdAt, seed.name],
  );
  sqlite.run(
    "INSERT INTO assignment (id, owner_user_id, created_at, updated_at, contractor_id, site_id, rate_cents, active) VALUES (?, ?, ?, ?, ?, ?, NULL, 1)",
    [seed.assignmentId, seed.userId, seed.createdAt, seed.createdAt, seed.contractorId, seed.siteId],
  );
  sqlite.run(
    "INSERT INTO assignment_schedule_version (id, owner_user_id, assignment_id, weekdays_mask, paid_minutes, effective_from, effective_to, created_at, updated_at) VALUES (?, ?, ?, 31, ?, '2026-08-31', NULL, ?, ?)",
    [seed.versionId, seed.userId, seed.assignmentId, seed.paidMinutes, seed.createdAt, seed.createdAt],
  );
  sqlite.run(
    "INSERT INTO time_entry (id, owner_user_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes, schedule_version_id) VALUES (?, ?, ?, ?, ?, ?, ?, 480, ?, 0, ?, ?, '', ?)",
    [
      seed.entryId,
      seed.userId,
      seed.createdAt,
      seed.createdAt,
      seed.contractorId,
      seed.siteId,
      seed.weekStart,
      480 + seed.paidMinutes,
      seed.paidMinutes,
      seed.rateCents,
      seed.versionId,
    ],
  );
  sqlite.run(
    "INSERT INTO week_approval (id, owner_user_id, created_at, updated_at, week_start, status, approved_at, reopened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [seed.approvalId, seed.userId, seed.createdAt, seed.createdAt, seed.weekStart, seed.weekStatus, seed.approvedAt, seed.reopenedAt],
  );
}

function expectMigrationAbort(sqlite: SqlJsDatabase, sql: string) {
  sqlite.run("BEGIN");
  let failed = false;
  try {
    sqlite.exec(sql);
    sqlite.run("COMMIT");
  } catch (error) {
    failed = true;
    sqlite.run("ROLLBACK");
    expect(errorText(error)).toMatch(/CHECK constraint failed/);
  }
  expect(failed).toBe(true);
}

function expectRolledBack(sqlite: SqlJsDatabase) {
  const names = tableNames(sqlite);
  expect(names).not.toContain("business");
  expect(names).not.toContain("business_member");
  expect(names).not.toContain("business_backfill_guard");
  for (const table of DOMAIN_TABLES) {
    const columns = query(sqlite, `PRAGMA table_info(${table})`).map((row) => row[1]);
    expect(columns).not.toContain("business_id");
  }
  const triggers = query(
    sqlite,
    "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%business_required%'",
  );
  expect(triggers).toEqual([]);
}

describe("business workspace migration", () => {
  it("backfills one owner business per user and leaves historical pay fields unchanged", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedOwner(sqlite, AVERY);
    seedOwner(sqlite, BLAKE);

    const migration = migrationSql("0004_business_workspace.sql");
    expect(migration.startsWith("PRAGMA foreign_keys=ON;")).toBe(true);
    expect(migration).not.toMatch(/\brate_cents\b/);
    expect(migration).not.toMatch(/\bpaid_minutes\b/);
    expect(migration).not.toMatch(/\bstatus\b/);
    expect(migration).not.toMatch(/\bapproved_at\b/);
    expect(migration).not.toMatch(/\breopened_at\b/);
    expect(migration).not.toMatch(/\bMIN\s*\(/i);
    expect(migration).not.toMatch(/\bLIMIT\b/i);
    expect(migration).not.toMatch(/INSERT\s+OR\s+IGNORE/i);
    expect(migration).not.toMatch(/\bDROP\b/);
    sqlite.exec(migration);

    expect(query(
      sqlite,
      "SELECT id, name, nzbn, address, contact_email, contact_phone, timezone, currency, week_start, onboarding_completed_at, created_at, updated_at FROM business ORDER BY id",
    )).toEqual([
      ["biz_user-avery", "Avery North", "", "", "avery.north@example.test", "", "Pacific/Auckland", "NZD", "monday", AVERY.createdAt, AVERY.createdAt, AVERY.createdAt],
      ["biz_user-blake", "Blake South", "", "", "blake.south@example.test", "", "Pacific/Auckland", "NZD", "monday", BLAKE.createdAt, BLAKE.createdAt, BLAKE.createdAt],
    ]);
    expect(query(
      sqlite,
      "SELECT id, business_id, user_id, role, active, created_at, updated_at FROM business_member ORDER BY id",
    )).toEqual([
      ["mem_user-avery", "biz_user-avery", "user-avery", "owner", 1, AVERY.createdAt, AVERY.createdAt],
      ["mem_user-blake", "biz_user-blake", "user-blake", "owner", 1, BLAKE.createdAt, BLAKE.createdAt],
    ]);

    for (const seed of [AVERY, BLAKE]) {
      const businessId = `biz_${seed.userId}`;
      expect(query(sqlite, "SELECT business_id FROM site WHERE id = ?", [seed.siteId])).toEqual([[businessId]]);
      expect(query(sqlite, "SELECT business_id FROM contractor WHERE id = ?", [seed.contractorId])).toEqual([[businessId]]);
      expect(query(sqlite, "SELECT business_id FROM assignment WHERE id = ?", [seed.assignmentId])).toEqual([[businessId]]);
      expect(query(sqlite, "SELECT business_id FROM assignment_schedule_version WHERE id = ?", [seed.versionId])).toEqual([[businessId]]);
      expect(query(sqlite, "SELECT business_id, rate_cents, paid_minutes, schedule_version_id FROM time_entry WHERE id = ?", [seed.entryId])).toEqual([
        [businessId, seed.rateCents, seed.paidMinutes, seed.versionId],
      ]);
      expect(query(sqlite, "SELECT business_id, status, approved_at, reopened_at FROM week_approval WHERE id = ?", [seed.approvalId])).toEqual([
        [businessId, seed.weekStatus, seed.approvedAt, seed.reopenedAt],
      ]);
      expect(query(sqlite, "SELECT paid_minutes FROM assignment_schedule_version WHERE id = ?", [seed.versionId])).toEqual([[seed.paidMinutes]]);
    }

    const businessIdIndexes = query(
      sqlite,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%business_id_idx' ORDER BY name",
    ).map((row) => row[0]);
    expect(businessIdIndexes).toEqual([
      "assignment_business_id_idx",
      "assignment_schedule_version_business_id_idx",
      "contractor_business_id_idx",
      "site_business_id_idx",
      "time_entry_business_id_idx",
      "week_approval_business_id_idx",
    ]);
    expect(query(
      sqlite,
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'business_member' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).map((row) => row[0])).toEqual([
      "business_member_active_user_uq",
      "business_member_business_user_uq",
      "business_member_user_id_idx",
    ]);
    const partialSql = String(query(sqlite, "SELECT sql FROM sqlite_master WHERE name = 'business_member_active_user_uq'")[0]?.[0]);
    expect(partialSql).toMatch(/UNIQUE/i);
    expect(partialSql).toMatch(/WHERE\s+`?active`?\s*=\s*1/i);
    for (const table of DOMAIN_TABLES) {
      const fk = query(sqlite, `PRAGMA foreign_key_list(${table})`).find((row) => row[3] === "business_id");
      expect(fk?.[2]).toBe("business");
      expect(String(fk?.[6]).toUpperCase()).toBe("RESTRICT");
    }
  });

  it("replays 0004 without duplicating businesses or changing snapshotted rates", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedOwner(sqlite, AVERY);
    seedOwner(sqlite, BLAKE);
    const migration = migrationSql("0004_business_workspace.sql");
    sqlite.exec(migration);
    reapplyMigration(sqlite, migration);

    expect(query(sqlite, "SELECT COUNT(*) FROM business")).toEqual([[2]]);
    expect(query(sqlite, "SELECT COUNT(*) FROM business_member")).toEqual([[2]]);
    expect(query(sqlite, "SELECT id FROM business ORDER BY id")).toEqual([["biz_user-avery"], ["biz_user-blake"]]);
    expect(query(sqlite, "SELECT id FROM business_member ORDER BY id")).toEqual([["mem_user-avery"], ["mem_user-blake"]]);
    expect(query(sqlite, "SELECT business_id, rate_cents FROM time_entry ORDER BY id")).toEqual([
      ["biz_user-avery", AVERY.rateCents],
      ["biz_user-blake", BLAKE.rateCents],
    ]);
    expect(query(sqlite, "SELECT COUNT(*) FROM business_backfill_guard")).toEqual([[1]]);
  });

  it("aborts when an assignment owner differs from its site or contractor owner and rolls the migration back", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedUser(sqlite, { userId: "user-avery", name: "Avery North", email: "avery.north@example.test", createdAt: AVERY.createdAt });
    seedUser(sqlite, { userId: "user-blake", name: "Blake South", email: "blake.south@example.test", createdAt: BLAKE.createdAt });
    sqlite.run(
      "INSERT INTO site (id, owner_user_id, created_at, updated_at, name, address, active) VALUES ('site-avery', 'user-avery', ?, ?, 'North Hall', '', 1)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO contractor (id, owner_user_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active) VALUES ('contractor-avery', 'user-avery', ?, ?, 'North Crew', '', '', 3000, 'NZD', 1)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO assignment (id, owner_user_id, created_at, updated_at, contractor_id, site_id, rate_cents, active) VALUES ('assignment-cross', 'user-blake', ?, ?, 'contractor-avery', 'site-avery', NULL, 1)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-kept', 'user-avery', ?, ?, 'contractor-avery', 'site-avery', '2026-08-31', 480, 570, 0, 90, 3250, '')",
      [AVERY.createdAt, AVERY.createdAt],
    );

    expectMigrationAbort(sqlite, migrationSql("0004_business_workspace.sql"));
    expectRolledBack(sqlite);
    expect(query(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-kept'")).toEqual([[3250, 90]]);
  });

  it("aborts when a time entry owner differs from its site owner and rolls the migration back", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedUser(sqlite, { userId: "user-avery", name: "Avery North", email: "avery.north@example.test", createdAt: AVERY.createdAt });
    seedUser(sqlite, { userId: "user-blake", name: "Blake South", email: "blake.south@example.test", createdAt: BLAKE.createdAt });
    sqlite.run(
      "INSERT INTO site (id, owner_user_id, created_at, updated_at, name, address, active) VALUES ('site-avery', 'user-avery', ?, ?, 'North Hall', '', 1)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO contractor (id, owner_user_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active) VALUES ('contractor-avery', 'user-avery', ?, ?, 'North Crew', '', '', 3000, 'NZD', 1)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO time_entry (id, owner_user_id, created_at, updated_at, contractor_id, site_id, work_date, start_minutes, end_minutes, break_minutes, paid_minutes, rate_cents, notes) VALUES ('entry-cross', 'user-blake', ?, ?, 'contractor-avery', 'site-avery', '2026-08-31', 480, 600, 0, 120, 2775, '')",
      [BLAKE.createdAt, BLAKE.createdAt],
    );

    expectMigrationAbort(sqlite, migrationSql("0004_business_workspace.sql"));
    expectRolledBack(sqlite);
    expect(query(sqlite, "SELECT rate_cents, paid_minutes FROM time_entry WHERE id = 'entry-cross'")).toEqual([[2775, 120]]);
  });

  it("aborts when a user name is blank after trim and rolls the migration back", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedUser(sqlite, {
      userId: "user-blank",
      name: "   ",
      email: "blank.user@example.test",
      createdAt: AVERY.createdAt,
    });

    expectMigrationAbort(sqlite, migrationSql("0004_business_workspace.sql"));
    expectRolledBack(sqlite);
  });

  it("rejects a null business id on insert or update and still allows other column updates", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedOwner(sqlite, AVERY);
    sqlite.exec(migrationSql("0004_business_workspace.sql"));

    expect(() => sqlite.run(
      "INSERT INTO site (id, owner_user_id, created_at, updated_at, name, address, active, business_id) VALUES ('site-null', 'user-avery', ?, ?, 'Null Hall', '', 1, NULL)",
      [AVERY.createdAt, AVERY.createdAt],
    )).toThrow(/business_required/);

    expect(() => sqlite.run("UPDATE site SET business_id = NULL WHERE id = 'site-avery'")).toThrow(/business_required/);

    sqlite.run("UPDATE site SET name = 'Renamed Hall' WHERE id = 'site-avery'");
    expect(query(sqlite, "SELECT name, business_id FROM site WHERE id = 'site-avery'")).toEqual([
      ["Renamed Hall", "biz_user-avery"],
    ]);
  });

  it("allows one active membership per user and an inactive membership at another business", async () => {
    const sqlite = await openSql();
    applyThrough0003(sqlite);
    seedOwner(sqlite, AVERY);
    sqlite.exec(migrationSql("0004_business_workspace.sql"));
    sqlite.run(
      "INSERT INTO business (id, name, nzbn, address, contact_email, contact_phone, timezone, currency, week_start, onboarding_completed_at, created_at, updated_at) VALUES ('biz_other', 'Other Co', '', '', 'other@example.test', '', 'Pacific/Auckland', 'NZD', 'monday', NULL, ?, ?)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    sqlite.run(
      "INSERT INTO business (id, name, nzbn, address, contact_email, contact_phone, timezone, currency, week_start, onboarding_completed_at, created_at, updated_at) VALUES ('biz_closed', 'Closed Co', '', '', 'closed@example.test', '', 'Pacific/Auckland', 'NZD', 'monday', NULL, ?, ?)",
      [AVERY.createdAt, AVERY.createdAt],
    );

    expect(() => sqlite.run(
      "INSERT INTO business_member (id, business_id, user_id, role, active, created_at, updated_at) VALUES ('mem_second_active', 'biz_other', 'user-avery', 'owner', 1, ?, ?)",
      [AVERY.createdAt, AVERY.createdAt],
    )).toThrow(/UNIQUE constraint failed: business_member\.user_id/);

    sqlite.run(
      "INSERT INTO business_member (id, business_id, user_id, role, active, created_at, updated_at) VALUES ('mem_inactive', 'biz_closed', 'user-avery', 'owner', 0, ?, ?)",
      [AVERY.createdAt, AVERY.createdAt],
    );
    expect(query(sqlite, "SELECT id, active FROM business_member WHERE user_id = 'user-avery' ORDER BY id")).toEqual([
      ["mem_inactive", 0],
      ["mem_user-avery", 1],
    ]);
  });

  it("adds 0004 without changing applied migrations 0000 through 0003", () => {
    expect(fs.existsSync(path.resolve("drizzle/0004_business_workspace.sql"))).toBe(true);
    for (const name of MIGRATION_FILES.slice(0, 4)) {
      const sql = migrationSql(name);
      expect(sql).not.toMatch(/business_id/);
      expect(sql).not.toMatch(/business_member/);
      expect(sql).not.toMatch(/CREATE TABLE `business`/);
    }
    expect(migrationSql("0003_recurring_schedules.sql")).not.toMatch(/business/);
    expect(migrationSql("0000_initial.sql")).toMatch(/^PRAGMA foreign_keys=ON;/);
  });

  it("declares business, membership, and a required business id on each domain table", () => {
    expect(getTableConfig(business).name).toBe("business");
    expect(business.onboardingCompletedAt.notNull).toBe(false);
    expect(business.timezone.default).toBe("Pacific/Auckland");
    expect(business.currency.default).toBe("NZD");
    expect(business.weekStart.default).toBe("monday");
    expect(business.nzbn.notNull).toBe(true);
    expect(business.contactEmail.notNull).toBe(true);

    const member = getTableConfig(businessMember);
    expect(member.name).toBe("business_member");
    expect(businessMember.active.default).toBe(1);
    expect(member.indexes.map((index) => index.config.name).sort()).toEqual([
      "business_member_active_user_uq",
      "business_member_business_user_uq",
      "business_member_user_id_idx",
    ]);
    const partial = member.indexes.find((index) => index.config.name === "business_member_active_user_uq");
    expect(partial?.config.unique).toBe(true);
    expect(partial?.config.where).toBeDefined();
    const memberBusinessFk = member.foreignKeys.find((fk) => fk.reference().columns.some((column) => column.name === "business_id"));
    expect(memberBusinessFk?.onDelete).toBe("restrict");
    const memberUserFk = member.foreignKeys.find((fk) => fk.reference().columns.some((column) => column.name === "user_id"));
    expect(memberUserFk?.onDelete).toBe("cascade");

    for (const table of [sites, contractors, assignments, assignmentScheduleVersions, timeEntries, weekApprovals]) {
      expect(table.businessId.notNull).toBe(true);
      expect(table.businessId.name).toBe("business_id");
      expect(table.ownerUserId.name).toBe("owner_user_id");
      const fk = getTableConfig(table).foreignKeys.find((item) => item.reference().columns.some((column) => column.name === "business_id"));
      expect(fk?.onDelete).toBe("restrict");
      expect(fk?.reference().foreignTable).toBe(business);
    }
  });
});
