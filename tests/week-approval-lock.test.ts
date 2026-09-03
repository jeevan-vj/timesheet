import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignments } from "../src/db/schema";
import { calculateEntryPayCents } from "../src/lib/payroll";
import { createSite } from "../src/services/sites";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  deleteTimeEntry,
  unassignAssignment,
  updateTimeEntry,
} from "../src/services/timesheet";
import { approveWeek, assertWeekUnlocked } from "../src/services/week-approval";

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

const weekStart = "2026-08-31";
const nextWeek = "2026-09-07";
const paidHours = {
  entryMode: "paid_hours" as const,
  paidMinutes: 480,
  notes: "",
};

function expectedFor(rateCents: number) {
  return { expectedPaidMinutes: 480, expectedPayCents: calculateEntryPayCents(480, rateCents) };
}

describe("week approval time-entry locks", () => {
  it("locks create on an approved week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    await expect(createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.warehouse.id,
      workDate: "2026-09-02",
    })).rejects.toThrow("week_locked");
  });

  it("locks delete of an entry whose work date is in an approved week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    await expect(deleteTimeEntry(database, "owner-a", entry.id)).rejects.toThrow("week_locked");
    expect(await deleteTimeEntry(database, "owner-b", entry.id)).toBe(false);
  });

  it("rejects PATCH of a locked-week entry even when the new date is unlocked", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    await expect(updateTimeEntry(database, "owner-a", entry.id, {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: nextWeek,
    })).rejects.toThrow("week_locked");
  });

  it("rejects PATCH that moves an unlocked entry into a locked week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    const later = await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: nextWeek,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    await expect(updateTimeEntry(database, "owner-a", later.id, {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-09-01",
    })).rejects.toThrow("week_locked");
  });

  it("allows create and update in an adjacent open week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    const later = await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: nextWeek,
    });
    const updated = await updateTimeEntry(database, "owner-a", later.id, {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-09-08",
      paidMinutes: 120,
    });
    expect(updated.workDate).toBe("2026-09-08");
    expect(updated.paidMinutes).toBe(120);
    expect(updated.rateCents).toBe(3_200);
  });

  it("does not restore or insert an assignment when locked create includes assignSite", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await unassignAssignment(database, "owner-a", owner.warehouseAssignment.id);
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    const before = await database.select().from(assignments);

    await expect(createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.warehouse.id,
      workDate: "2026-09-02",
      assignSite: { rateCents: 2_500 },
    })).rejects.toThrow("week_locked");

    expect(await database.select().from(assignments)).toEqual(before);
    expect(before.find((row) => row.id === owner.warehouseAssignment.id)?.active).toBe(false);
  });

  it("does not throw week_locked for another owner and still 404s missing entries", async () => {
    const { sqlite, database } = await openMemoryDb();
    const ownerA = await seedOwner(database, sqlite, "owner-a");
    const ownerB = await seedOwner(database, sqlite, "owner-b");
    const entry = await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: ownerA.contractor.id,
      siteId: ownerA.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));

    await expect(assertWeekUnlocked(database, "owner-b", weekStart)).resolves.toBeUndefined();
    await expect(updateTimeEntry(database, "owner-b", entry.id, {
      ...paidHours,
      contractorId: ownerA.contractor.id,
      siteId: ownerA.harbour.id,
      workDate: weekStart,
    })).rejects.toThrow("not_found");
    expect(await deleteTimeEntry(database, "owner-b", entry.id)).toBe(false);

    const created = await createTimeEntry(database, "owner-b", {
      ...paidHours,
      contractorId: ownerB.contractor.id,
      siteId: ownerB.harbour.id,
      workDate: weekStart,
    });
    expect(created.ownerUserId).toBe("owner-b");
  });

  it("still validates invalid_shift before the lock check on create", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      ...paidHours,
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
    });
    await approveWeek(database, "owner-a", weekStart, expectedFor(3_200));
    await expect(createTimeEntry(database, "owner-a", {
      entryMode: "clock",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-09-02",
      startMinutes: 600,
      endMinutes: 600,
      breakMinutes: 0,
      notes: "",
    })).rejects.toThrow("invalid_shift");
  });
});
