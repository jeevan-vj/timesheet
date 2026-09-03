import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { contractors, timeEntries } from "../src/db/schema";
import { calculateEntryPayCents } from "../src/lib/payroll";
import { clockFieldsForWrite } from "../src/lib/time-entry-write";
import { getContractorWeekRemittance } from "../src/services/remittance";
import { createSite } from "../src/services/sites";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  deleteTimeEntry,
} from "../src/services/timesheet";
import { approveWeek } from "../src/services/week-approval";

type RemittanceDb = Parameters<typeof getContractorWeekRemittance>[0];

const weekStart = "2026-08-31";

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8"));
  const database = drizzle(sqlite) as unknown as RemittanceDb;
  return { sqlite, database };
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
    [id, id, `${id}@example.test`],
  );
}

async function seedOwner(database: RemittanceDb, sqlite: SqlJsDatabase, ownerUserId: string) {
  insertUser(sqlite, ownerUserId);
  const harbour = await createSite(database, ownerUserId, { name: `${ownerUserId}-harbour`, address: "" });
  const warehouse = await createSite(database, ownerUserId, { name: `${ownerUserId}-warehouse`, address: "" });
  const contractor = await createContractor(database, ownerUserId, {
    name: `${ownerUserId}-aroha`,
    email: "",
    phone: "",
    defaultRateCents: 4_500,
  });
  await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: harbour.id,
    rateCents: 3_200,
  });
  await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: warehouse.id,
    rateCents: 2_800,
  });
  return { contractor, harbour, warehouse };
}

describe("contractor week remittance query", () => {
  it("scopes rows to the session owner and hides another owner's contractor", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const other = await seedOwner(database, sqlite, "owner-b");
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
      paidMinutes: 480,
      notes: "owner-a only",
    });
    await createTimeEntry(database, "owner-b", {
      entryMode: "paid_hours",
      contractorId: other.contractor.id,
      siteId: other.harbour.id,
      workDate: weekStart,
      paidMinutes: 120,
      notes: "foreign",
    });

    const visible = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(visible.contractor.id).toBe(owner.contractor.id);
    expect(visible.entries).toHaveLength(1);
    expect(visible.entries[0]).toMatchObject({
      paidMinutes: 480,
      rateCents: 3_200,
      siteName: "owner-a-harbour",
      contractorName: "owner-a-aroha",
    });

    await expect(getContractorWeekRemittance(database, "owner-a", other.contractor.id, weekStart)).rejects.toThrow("not_found");
    await expect(getContractorWeekRemittance(database, "owner-b", owner.contractor.id, weekStart)).rejects.toThrow("not_found");
  });

  it("loads an archived contractor's historical week rows", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
      paidMinutes: 90,
      notes: "before archive",
    });
    await database.update(contractors).set({ active: false }).where(eq(contractors.id, owner.contractor.id));

    const remittance = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(remittance.contractor.id).toBe(owner.contractor.id);
    expect(remittance.entries).toEqual([expect.objectContaining({
      id: entry.id,
      paidMinutes: 90,
      rateCents: 3_200,
      contractorName: "owner-a-aroha",
    })]);
  });

  it("changes line count and total when an entry is added or deleted", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const harbour = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
      paidMinutes: 480,
      notes: "",
    });

    const first = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(first.entries).toHaveLength(1);
    const firstTotal = first.entries.reduce((sum, entry) => sum + calculateEntryPayCents(entry.paidMinutes, entry.rateCents), 0);
    expect(firstTotal).toBe(calculateEntryPayCents(480, 3_200));

    const warehouse = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.warehouse.id,
      workDate: "2026-09-01",
      paidMinutes: 90,
      notes: "",
    });
    const withExtra = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(withExtra.entries).toHaveLength(2);
    const extraTotal = withExtra.entries.reduce((sum, entry) => sum + calculateEntryPayCents(entry.paidMinutes, entry.rateCents), 0);
    expect(extraTotal).toBe(calculateEntryPayCents(480, 3_200) + calculateEntryPayCents(90, 2_800));
    expect(extraTotal).not.toBe(firstTotal);

    expect(await deleteTimeEntry(database, "owner-a", warehouse.id)).toBe(true);
    const afterDelete = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(afterDelete.entries).toHaveLength(1);
    expect(afterDelete.entries[0]?.id).toBe(harbour.id);
    const deletedTotal = afterDelete.entries.reduce((sum, entry) => sum + calculateEntryPayCents(entry.paidMinutes, entry.rateCents), 0);
    expect(deletedTotal).toBe(firstTotal);
  });

  it("throws no_entries for an owned contractor with no rows in that week", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: "2026-08-24",
      paidMinutes: 60,
      notes: "",
    });
    await expect(getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart)).rejects.toThrow("no_entries");
  });

  it("still loads remittance after the week is approved", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
      paidMinutes: 480,
      notes: "",
    });
    await approveWeek(database as Parameters<typeof approveWeek>[0], "owner-a", {
      weekStart,
      expectedPaidMinutes: 480,
      expectedPayCents: calculateEntryPayCents(480, 3_200),
    });
    await expect(createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.warehouse.id,
      workDate: "2026-09-01",
      paidMinutes: 60,
      notes: "",
    })).rejects.toThrow("week_locked");
    const remittance = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(remittance.entries).toHaveLength(1);
    expect(remittance.entries[0]).toMatchObject({ paidMinutes: 480, rateCents: 3_200 });
  });

  it("treats an absence-only week as entries at $0, not no_entries", async () => {
    const { sqlite, database } = await openMemoryDb();
    const owner = await seedOwner(database, sqlite, "owner-a");
    const createdAt = new Date();
    await database.insert(timeEntries).values({
      id: crypto.randomUUID(),
      ownerUserId: "owner-a",
      contractorId: owner.contractor.id,
      siteId: owner.harbour.id,
      workDate: weekStart,
      notes: "",
      ...clockFieldsForWrite({ entryMode: "absent" }),
      rateCents: 3_200,
      occurrenceKind: "absent",
      scheduleVersionId: null,
      createdAt,
      updatedAt: createdAt,
    });
    const remittance = await getContractorWeekRemittance(database, "owner-a", owner.contractor.id, weekStart);
    expect(remittance.entries).toHaveLength(1);
    expect(remittance.entries[0]).toMatchObject({ paidMinutes: 0, rateCents: 3_200 });
    expect(remittance.entries[0]?.paidMinutes).toBe(0);
  });
});
