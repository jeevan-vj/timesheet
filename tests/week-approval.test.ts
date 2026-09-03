import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignments, contractors, timeEntries, weekApprovals } from "../src/db/schema";
import { calculateEntryPayCents } from "../src/lib/payroll";
import { createSite } from "../src/services/sites";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  getDashboard,
  updateAssignmentRate,
  updateContractor,
} from "../src/services/timesheet";
import { approveWeek, getWeekApproval, reopenWeek } from "../src/services/week-approval";

type TimesheetDb = Parameters<typeof createTimeEntry>[0];

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  const database = drizzle(sqlite) as unknown as TimesheetDb;
  return { sqlite, database };
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
    [id, id, `${id}@example.test`],
  );
}

async function seedOwner(database: TimesheetDb, sqlite: SqlJsDatabase, ownerUserId: string) {
  insertUser(sqlite, ownerUserId);
  const site = await createSite(database, ownerUserId, { name: `${ownerUserId}-harbour`, address: "" });
  const contractor = await createContractor(database, ownerUserId, {
    name: `${ownerUserId}-aroha`,
    email: "",
    phone: "",
    defaultRateCents: 3_000,
  });
  const assignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: site.id,
    rateCents: 3_200,
  });
  return { contractor, site, assignment };
}

const weekStart = "2026-08-31";
const paidMinutes = 480;
const rateCents = 3_200;
const expected = { expectedPaidMinutes: paidMinutes, expectedPayCents: calculateEntryPayCents(paidMinutes, rateCents) };

async function addEntry(database: TimesheetDb, ownerUserId: string, contractorId: string, siteId: string, workDate = weekStart) {
  return createTimeEntry(database, ownerUserId, {
    entryMode: "paid_hours",
    contractorId,
    siteId,
    workDate,
    paidMinutes,
    notes: "weekly clean",
  });
}

function approvalSource(): string {
  return fs.readFileSync(path.resolve("src/services/week-approval.ts"), "utf8");
}

describe("week approval service", () => {
  it("inserts an approved row and returns ISO timestamps without an owner id", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);

    expect(await getWeekApproval(database, "owner-a", weekStart)).toEqual({
      status: "open",
      approvedAt: null,
      reopenedAt: null,
    });

    const approved = await approveWeek(database, "owner-a", weekStart, expected);
    expect(approved.status).toBe("approved");
    expect(approved.reopenedAt).toBeNull();
    expect(approved.approvedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(approved).not.toHaveProperty("ownerUserId");
    expect(approved).not.toHaveProperty("owner_user_id");

    expect(await getWeekApproval(database, "owner-a", weekStart)).toEqual(approved);
    const dashboard = await getDashboard(database, "owner-a", weekStart);
    expect(dashboard.approval).toEqual(approved);
    expect(dashboard.entries).toHaveLength(1);
  });

  it("rejects a second approve while already approved", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    await approveWeek(database, "owner-a", weekStart, expected);
    await expect(approveWeek(database, "owner-a", weekStart, expected)).rejects.toThrow("week_already_approved");
    expect((await database.select().from(weekApprovals)).filter((row) => row.ownerUserId === "owner-a")).toHaveLength(1);
  });

  it("reopens an approved week and keeps approvedAt", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    const approved = await approveWeek(database, "owner-a", weekStart, expected);
    const reopened = await reopenWeek(database, "owner-a", weekStart, expected);
    expect(reopened.status).toBe("open");
    expect(reopened.approvedAt).toBe(approved.approvedAt);
    expect(reopened.reopenedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("rejects reopen when the week is open or never approved", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    await expect(reopenWeek(database, "owner-a", weekStart, expected)).rejects.toThrow("week_not_approved");
    await approveWeek(database, "owner-a", weekStart, expected);
    await reopenWeek(database, "owner-a", weekStart, expected);
    await expect(reopenWeek(database, "owner-a", weekStart, expected)).rejects.toThrow("week_not_approved");
  });

  it("re-approves a reopened week with a new approvedAt and the same reopenedAt", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    await approveWeek(database, "owner-a", weekStart, expected);
    const reopened = await reopenWeek(database, "owner-a", weekStart, expected);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const approvedAgain = await approveWeek(database, "owner-a", weekStart, expected);
    expect(approvedAgain.status).toBe("approved");
    expect(approvedAgain.reopenedAt).toBe(reopened.reopenedAt);
    expect(approvedAgain.approvedAt).not.toBe(reopened.approvedAt);
    expect((await database.select().from(weekApprovals)).filter((row) => row.ownerUserId === "owner-a")).toHaveLength(1);
  });

  it("rejects stale totals and writes nothing", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    const beforeEntries = await database.select().from(timeEntries);
    await expect(approveWeek(database, "owner-a", weekStart, {
      expectedPaidMinutes: 60,
      expectedPayCents: expected.expectedPayCents,
    })).rejects.toThrow("stale_week_totals");
    expect(await database.select().from(weekApprovals)).toHaveLength(0);
    expect(await database.select().from(timeEntries)).toEqual(beforeEntries);

    await approveWeek(database, "owner-a", weekStart, expected);
    await expect(reopenWeek(database, "owner-a", weekStart, {
      expectedPaidMinutes: expected.expectedPaidMinutes,
      expectedPayCents: expected.expectedPayCents + 1,
    })).rejects.toThrow("stale_week_totals");
    expect(await getWeekApproval(database, "owner-a", weekStart)).toMatchObject({ status: "approved" });
    expect((await database.select().from(timeEntries))[0]?.id).toBe(entry.id);
  });

  it("approves an empty week at 0/0", async () => {
    const { sqlite, database } = await openMemoryDb();
    await seedOwner(database, sqlite, "owner-a");
    const approved = await approveWeek(database, "owner-a", weekStart, { expectedPaidMinutes: 0, expectedPayCents: 0 });
    expect(approved.status).toBe("approved");
    expect(await getDashboard(database, "owner-a", weekStart)).toMatchObject({
      entries: [],
      approval: approved,
    });
  });

  it("keeps owner B from reading or mutating owner A's approval row", async () => {
    const { sqlite, database } = await openMemoryDb();
    const ownerA = await seedOwner(database, sqlite, "owner-a");
    await seedOwner(database, sqlite, "owner-b");
    await addEntry(database, "owner-a", ownerA.contractor.id, ownerA.site.id);
    const approved = await approveWeek(database, "owner-a", weekStart, expected);

    expect(await getWeekApproval(database, "owner-b", weekStart)).toEqual({
      status: "open",
      approvedAt: null,
      reopenedAt: null,
    });
    expect((await getDashboard(database, "owner-b", weekStart)).approval).toEqual({
      status: "open",
      approvedAt: null,
      reopenedAt: null,
    });
    await expect(reopenWeek(database, "owner-b", weekStart, { expectedPaidMinutes: 0, expectedPayCents: 0 })).rejects.toThrow("week_not_approved");
    expect(await getWeekApproval(database, "owner-a", weekStart)).toEqual(approved);
  });

  it("lets owner B approve the same Monday independently", async () => {
    const { sqlite, database } = await openMemoryDb();
    const ownerA = await seedOwner(database, sqlite, "owner-a");
    const ownerB = await seedOwner(database, sqlite, "owner-b");
    await addEntry(database, "owner-a", ownerA.contractor.id, ownerA.site.id);
    await addEntry(database, "owner-b", ownerB.contractor.id, ownerB.site.id);
    const a = await approveWeek(database, "owner-a", weekStart, expected);
    const b = await approveWeek(database, "owner-b", weekStart, expected);
    expect(a.status).toBe("approved");
    expect(b.status).toBe("approved");
    const rows = await database.select().from(weekApprovals);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.ownerUserId).sort()).toEqual(["owner-a", "owner-b"]);
  });

  it("does not update time_entry on approve or reopen", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    const before = await database.select().from(timeEntries);
    await approveWeek(database, "owner-a", weekStart, expected);
    await reopenWeek(database, "owner-a", weekStart, expected);
    expect(await database.select().from(timeEntries)).toEqual(before);
    expect(approvalSource()).not.toMatch(/\.update\(\s*timeEntries\s*\)/);
    expect(approvalSource()).toMatch(/isUniqueConstraintError[\s\S]*week_already_approved/);
  });

  it("leaves locked-week rate_cents unchanged after contractor and assignment rate edits", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await addEntry(database, "owner-a", owner.contractor.id, owner.site.id);
    expect(entry.rateCents).toBe(3_200);
    await approveWeek(database, "owner-a", weekStart, expected);

    await updateContractor(database, "owner-a", owner.contractor.id, {
      name: owner.contractor.name,
      email: "",
      phone: "",
      defaultRateCents: 4_500,
    });
    await updateAssignmentRate(database, "owner-a", owner.assignment.id, { rateCents: 5_000 });
    await database.update(contractors).set({ defaultRateCents: 4_500 }).where(eq(contractors.id, owner.contractor.id));
    await database.update(assignments).set({ rateCents: 5_000 }).where(eq(assignments.id, owner.assignment.id));

    const remaining = await database.select().from(timeEntries);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.rateCents).toBe(3_200);
    expect(remaining[0]?.paidMinutes).toBe(480);
  });
});
