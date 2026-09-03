import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignments, contractors, timeEntries } from "../src/db/schema";
import { createSite } from "../src/services/sites";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  deleteTimeEntry,
  getTimeEntry,
  updateTimeEntry,
} from "../src/services/timesheet";

type TimesheetDb = Parameters<typeof updateTimeEntry>[0];

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

describe("time entry service isolation and snapshots", () => {
  it("reads an owner entry with same-owner contractor and site names, and hides another owner's id", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const other = await seedOwner(database, sqlite, "owner-b");
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "Keys returned",
    });
    const foreign = await createTimeEntry(database, "owner-b", {
      entryMode: "clock",
      contractorId: other.contractor.id,
      siteId: other.harbour.id,
      workDate: "2026-08-31",
      startMinutes: 480,
      endMinutes: 960,
      breakMinutes: 30,
      notes: "",
    });

    const visible = await getTimeEntry(database, "owner-a", entry.id);
    expect(visible).toMatchObject({
      id: entry.id,
      contractorId: owner.contractor.id,
      contractorName: "owner-a-aroha",
      siteId: owner.harbour.id,
      siteName: "owner-a-harbour",
      paidMinutes: 480,
      rateCents: 3_200,
      notes: "Keys returned",
      entryMode: "paid_hours",
    });
    expect(await getTimeEntry(database, "owner-a", foreign.id)).toBeNull();
  });

  it("keeps the snapshotted rate when duration changes after current rates move", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "",
    });
    expect(entry.rateCents).toBe(3_200);

    await database.update(contractors).set({ defaultRateCents: 4_000 }).where(eq(contractors.id, owner.contractor.id));
    await database.update(assignments).set({ rateCents: 4_500 }).where(eq(assignments.id, owner.harbourAssignment.id));
    sqlite.run("UPDATE time_entry SET updated_at = 1 WHERE id = ?", [entry.id]);

    const updated = await updateTimeEntry(database, "owner-a", entry.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 120,
      notes: "shorter",
    });
    expect(updated.rateCents).toBe(3_200);
    expect(updated.paidMinutes).toBe(120);
    expect(updated.startMinutes).toBe(0);
    expect(updated.endMinutes).toBe(120);
    expect(updated.breakMinutes).toBe(0);
    expect(updated.notes).toBe("shorter");
    expect(new Date(updated.updatedAt).valueOf()).toBeGreaterThan(1_000);
  });

  it("snapshots the current assignment rate when contractor or site is reclassified", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "clock",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
      notes: "",
    });
    expect(entry.rateCents).toBe(3_200);

    const updated = await updateTimeEntry(database, "owner-a", entry.id, {
      entryMode: "clock",
      contractorId: owner.contractor.id,
      siteId: owner.warehouse.id,
      workDate: "2026-08-31",
      startMinutes: 480,
      endMinutes: 990,
      breakMinutes: 30,
      notes: "",
    });
    expect(updated.siteId).toBe(owner.warehouse.id);
    expect(updated.rateCents).toBe(2_800);
  });

  it("rejects an update that collides with another owner/contractor/site/date row", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const first = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 60,
      notes: "",
    });
    const second = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-09-01",
      paidMinutes: 90,
      notes: "",
    });

    await expect(updateTimeEntry(database, "owner-a", second.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 90,
      notes: "",
    })).rejects.toThrow("duplicate_entry");

    const unchanged = await getTimeEntry(database, "owner-a", second.id);
    expect(unchanged?.workDate).toBe("2026-09-01");
    expect(unchanged?.id).toBe(second.id);
    expect(first.workDate).toBe("2026-08-31");
  });

  it("returns not_found for cross-owner update and delete and leaves the row unchanged", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await seedOwner(database, sqlite, "owner-b");
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "keep",
    });

    await expect(updateTimeEntry(database, "owner-b", entry.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 60,
      notes: "stolen",
    })).rejects.toThrow("not_found");
    expect(await deleteTimeEntry(database, "owner-b", entry.id)).toBe(false);

    const remaining = await database.select().from(timeEntries);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.notes).toBe("keep");
    expect(remaining[0]?.paidMinutes).toBe(480);
    expect(remaining[0]?.ownerUserId).toBe("owner-a");
  });
});
