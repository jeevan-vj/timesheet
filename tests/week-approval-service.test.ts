import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignments, contractors, timeEntries, weekApprovals } from "../src/db/schema";
import { calculateEntryPayCents } from "../src/lib/payroll";
import { findWeekApproval } from "../src/lib/week-approval-query";
import { createSite } from "../src/services/sites";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  deleteTimeEntry,
  getDashboard,
  getTimeEntry,
  unassignAssignment,
  updateAssignmentRate,
  updateContractor,
  updateTimeEntry,
} from "../src/services/timesheet";
import { approveWeek, reopenWeek } from "../src/services/week-approval";

type TimesheetDb = Parameters<typeof getDashboard>[0];

const MONDAY = "2026-08-31";
const NEXT_MONDAY = "2026-09-07";

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
  const harbour = await createSite(database, ownerUserId, { name: `${ownerUserId}-harbour`, address: "" });
  const warehouse = await createSite(database, ownerUserId, { name: `${ownerUserId}-warehouse`, address: "" });
  const contractor = await createContractor(database, ownerUserId, {
    name: `${ownerUserId}-aroha`,
    email: "",
    phone: "",
    defaultRateCents: 3_000,
  });
  const harbourAssignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: harbour.id,
    rateCents: 3_200,
  });
  const warehouseAssignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: warehouse.id,
    rateCents: 2_800,
  });
  return { contractor, harbour, warehouse, harbourAssignment, warehouseAssignment };
}

const paidHours = (contractorId: string, siteId: string, workDate: string, paidMinutes: number) => ({
  entryMode: "paid_hours" as const,
  contractorId,
  siteId,
  workDate,
  paidMinutes,
  notes: "",
});

describe("week approval service", () => {
  it("treats a missing week_approval row as an open dashboard week", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");

    const dashboard = await getDashboard(database, "owner-a", MONDAY);
    expect(dashboard.approval).toEqual({ status: "open", approvedAt: null, reopenedAt: null });
    expect(dashboard.approval).not.toHaveProperty("id");
    expect(dashboard.approval).not.toHaveProperty("ownerUserId");
  });

  it("approves an empty week at 0/0 and stores one unique owner+week row", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");

    const approved = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    });
    expect(approved).toMatchObject({ weekStart: MONDAY, status: "approved", reopenedAt: null });
    expect(approved).not.toHaveProperty("ownerUserId");
    expect(typeof approved.id).toBe("string");
    expect(typeof approved.approvedAt).toBe("string");
    expect(() => new Date(approved.approvedAt).toISOString()).not.toThrow();

    const again = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    });
    expect(again.id).toBe(approved.id);
    expect(again.approvedAt).toBe(approved.approvedAt);

    const rows = await database.select().from(weekApprovals);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ownerUserId).toBe("owner-a");
  });

  it("approves matching current totals and is idempotent without rewriting timestamps", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 480));
    const expectedPayCents = calculateEntryPayCents(480, entry.rateCents);

    const first = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 480,
      expectedPayCents,
    });
    const stored = await findWeekApproval(database, "owner-a", MONDAY);
    expect(first.status).toBe("approved");
    expect(first.approvedAt).toBe(stored?.approvedAt.toISOString());

    const second = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 480,
      expectedPayCents,
    });
    expect(second).toEqual(first);
    const after = await findWeekApproval(database, "owner-a", MONDAY);
    expect(after?.approvedAt).toEqual(stored?.approvedAt);
    expect(after?.updatedAt).toEqual(stored?.updatedAt);
  });

  it("throws stale_week on a totals mismatch and does not insert or bump timestamps", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 120));

    await expect(approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    })).rejects.toThrow("stale_week");
    expect(await findWeekApproval(database, "owner-a", MONDAY)).toBeNull();
    expect(await database.select().from(weekApprovals)).toHaveLength(0);
  });

  it("locks create, update, and delete on an approved week without writing", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 60));
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 60,
      expectedPayCents: calculateEntryPayCents(60, entry.rateCents),
    });

    await expect(createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.warehouse.id, "2026-09-01", 30))).rejects.toThrow("week_locked");
    await expect(updateTimeEntry(database, "owner-a", entry.id, paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 90))).rejects.toThrow("week_locked");
    await expect(deleteTimeEntry(database, "owner-a", entry.id)).rejects.toThrow("week_locked");

    const remaining = await getTimeEntry(database, "owner-a", entry.id);
    expect(remaining?.paidMinutes).toBe(60);
    expect(await database.select().from(timeEntries)).toHaveLength(1);
  });

  it("rejects a date move into or out of a locked week without writing", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const locked = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 60));
    const open = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, NEXT_MONDAY, 45));
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 60,
      expectedPayCents: calculateEntryPayCents(60, locked.rateCents),
    });

    await expect(updateTimeEntry(database, "owner-a", open.id, paidHours(owner.contractor.id, owner.harbour.id, "2026-09-01", 45))).rejects.toThrow("week_locked");
    await expect(updateTimeEntry(database, "owner-a", locked.id, paidHours(owner.contractor.id, owner.harbour.id, NEXT_MONDAY, 60))).rejects.toThrow("week_locked");

    expect((await getTimeEntry(database, "owner-a", open.id))?.workDate).toBe(NEXT_MONDAY);
    expect((await getTimeEntry(database, "owner-a", locked.id))?.workDate).toBe(MONDAY);
  });

  it("does not restore or create an assignment when create is locked", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    expect(await unassignAssignment(database, "owner-a", owner.harbourAssignment.id)).toBe(true);
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    });

    await expect(createTimeEntry(database, "owner-a", {
      ...paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 60),
      assignSite: { rateCents: 3_500 },
    })).rejects.toThrow("week_locked");

    const [assignment] = await database.select().from(assignments).where(eq(assignments.id, owner.harbourAssignment.id));
    expect(assignment?.active).toBe(false);
    expect(assignment?.rateCents).toBe(3_200);
    expect(await database.select().from(timeEntries)).toHaveLength(0);
  });

  it("reopens an approved week, keeps approvedAt, and allows writes again", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 60));
    const approved = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 60,
      expectedPayCents: calculateEntryPayCents(60, entry.rateCents),
    });

    const reopened = await reopenWeek(database, "owner-a", { weekStart: MONDAY });
    expect(reopened.status).toBe("reopened");
    expect(reopened.approvedAt).toBe(approved.approvedAt);
    expect(reopened.reopenedAt).toEqual(expect.any(String));
    expect(reopened.reopenedAt).not.toBeNull();

    const dashboard = await getDashboard(database, "owner-a", MONDAY);
    expect(dashboard.approval).toEqual({
      status: "reopened",
      approvedAt: reopened.approvedAt,
      reopenedAt: reopened.reopenedAt,
    });

    const updated = await updateTimeEntry(database, "owner-a", entry.id, paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 90));
    expect(updated.paidMinutes).toBe(90);
  });

  it("rejects reopen of a never-approved week", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    await expect(reopenWeek(database, "owner-a", { weekStart: MONDAY })).rejects.toThrow("week_not_approved");
    expect(await findWeekApproval(database, "owner-a", MONDAY)).toBeNull();
  });

  it("is idempotent on reopen and does not rewrite timestamps", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    await approveWeek(database, "owner-a", { weekStart: MONDAY, expectedPaidMinutes: 0, expectedPayCents: 0 });
    const first = await reopenWeek(database, "owner-a", { weekStart: MONDAY });
    const stored = await findWeekApproval(database, "owner-a", MONDAY);
    const second = await reopenWeek(database, "owner-a", { weekStart: MONDAY });
    expect(second).toEqual(first);
    const after = await findWeekApproval(database, "owner-a", MONDAY);
    expect(after?.reopenedAt).toEqual(stored?.reopenedAt);
    expect(after?.approvedAt).toEqual(stored?.approvedAt);
    expect(after?.updatedAt).toEqual(stored?.updatedAt);
  });

  it("re-approves a reopened week with a new approvedAt and cleared reopenedAt", async () => {
    const { sqlite, database } = await openMemoryDb();
    insertUser(sqlite, "owner-a");
    const first = await approveWeek(database, "owner-a", { weekStart: MONDAY, expectedPaidMinutes: 0, expectedPayCents: 0 });
    sqlite.run("UPDATE week_approval SET approved_at = 1700000000, updated_at = 1700000000 WHERE id = ?", [first.id]);
    const reopened = await reopenWeek(database, "owner-a", { weekStart: MONDAY });
    expect(reopened.approvedAt).toBe(new Date(1_700_000_000_000).toISOString());
    const again = await approveWeek(database, "owner-a", { weekStart: MONDAY, expectedPaidMinutes: 0, expectedPayCents: 0 });
    expect(again.status).toBe("approved");
    expect(again.reopenedAt).toBeNull();
    expect(again.approvedAt).not.toBe(reopened.approvedAt);
    expect(await database.select().from(weekApprovals)).toHaveLength(1);
  });

  it("isolates week_approval rows per owner for the same Monday", async () => {
    const { sqlite, database } = await openMemoryDb();
    const ownerA = await seedOwner(database, sqlite, "owner-a");
    await seedOwner(database, sqlite, "owner-b");
    const entry = await createTimeEntry(database, "owner-a", paidHours(ownerA.contractor.id, ownerA.harbour.id, MONDAY, 60));
    const aApproved = await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 60,
      expectedPayCents: calculateEntryPayCents(60, entry.rateCents),
    });

    const bDashboard = await getDashboard(database, "owner-b", MONDAY);
    expect(bDashboard.approval).toEqual({ status: "open", approvedAt: null, reopenedAt: null });
    await expect(reopenWeek(database, "owner-b", { weekStart: MONDAY })).rejects.toThrow("week_not_approved");

    const bApproved = await approveWeek(database, "owner-b", {
      weekStart: MONDAY,
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    });
    expect(bApproved.id).not.toBe(aApproved.id);

    const aRow = await findWeekApproval(database, "owner-a", MONDAY);
    const bRow = await findWeekApproval(database, "owner-b", MONDAY);
    expect(aRow?.id).toBe(aApproved.id);
    expect(bRow?.id).toBe(bApproved.id);
    expect(aRow?.status).toBe("approved");
    expect(await database.select().from(weekApprovals)).toHaveLength(2);
  });

  it("does not rewrite snapshotted entry rates after approve when current rates change", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 120));
    expect(entry.rateCents).toBe(3_200);
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 120,
      expectedPayCents: calculateEntryPayCents(120, 3_200),
    });

    await updateContractor(database, "owner-a", owner.contractor.id, {
      name: owner.contractor.name,
      email: "",
      phone: "",
      defaultRateCents: 4_500,
    });
    await updateAssignmentRate(database, "owner-a", owner.harbourAssignment.id, { rateCents: 4_800 });

    const [stored] = await database.select().from(timeEntries).where(eq(timeEntries.id, entry.id));
    expect(stored?.rateCents).toBe(3_200);
    await expect(updateTimeEntry(database, "owner-a", entry.id, paidHours(owner.contractor.id, owner.harbour.id, MONDAY, 90))).rejects.toThrow("week_locked");
    expect((await getTimeEntry(database, "owner-a", entry.id))?.rateCents).toBe(3_200);
    expect((await getTimeEntry(database, "owner-a", entry.id))?.paidMinutes).toBe(120);
  });
});
