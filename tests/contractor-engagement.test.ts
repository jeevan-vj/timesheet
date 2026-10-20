import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { summarizeWeek } from "../src/lib/payroll";
import { getContractorWeekRemittance } from "../src/services/remittance";
import { createSite } from "../src/services/sites";
import {
  archiveContractor,
  createAssignment,
  createContractor,
  createTimeEntry,
  getContractor,
  getDashboard,
  listContractors,
  restoreContractor,
  updateContractor,
} from "../src/services/timesheet";
import { execContractorEngagementMigration, seedOwnerWorkspace } from "./owner-workspace";

type TimesheetDb = Parameters<typeof createContractor>[0];

const MIGRATIONS = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
] as const;

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  for (const name of MIGRATIONS) sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
  execContractorEngagementMigration(sqlite);
  const database = drizzle(sqlite) as unknown as TimesheetDb;
  return { sqlite, database };
}

function scalar(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []) {
  const statement = sqlite.prepare(sql);
  statement.bind(params);
  const value = statement.step() ? statement.get()[0] : undefined;
  statement.free();
  return value;
}

describe("contractor engagement profile", () => {
  it("stores engagement fields for the owning business and hides them from another owner", async () => {
    const { database, sqlite } = await openMemoryDb();
    seedOwnerWorkspace(sqlite, "owner-a");
    seedOwnerWorkspace(sqlite, "owner-b");
    const created = await createContractor(database, "owner-a", {
      name: "Aroha",
      email: "aroha@example.test",
      phone: "021000000",
      defaultRateCents: 3_200,
      preferredName: "Ro",
      startDate: "2026-08-03",
      engagementStatus: "draft",
      gstRegistered: true,
      gstNumber: "123456789",
      internalNotes: "Key holder",
      emergencyContactName: "Sam",
      emergencyContactPhone: "021111111",
    });

    expect(created).toMatchObject({
      name: "Aroha",
      active: false,
      preferredName: "Ro",
      startDate: "2026-08-03",
      engagementStatus: "draft",
      gstRegistered: true,
      gstNumber: "123456789",
      internalNotes: "Key holder",
      emergencyContactName: "Sam",
      emergencyContactPhone: "021111111",
    });
    expect(created).not.toHaveProperty("ownerUserId");
    expect(created).not.toHaveProperty("businessId");

    expect((await listContractors(database, "owner-a", false)).map((row) => row.id)).toEqual([created.id]);
    expect(await getContractor(database, "owner-a", created.id)).toMatchObject({ internalNotes: "Key holder" });

    await expect(getContractor(database, "owner-b", created.id)).rejects.toThrow("not_found");
    await expect(updateContractor(database, "owner-b", created.id, {
      name: "Stolen",
      email: "",
      phone: "",
      defaultRateCents: 4_000,
      internalNotes: "nope",
    })).rejects.toThrow("not_found");
    await expect(archiveContractor(database, "owner-b", created.id)).rejects.toThrow("not_found");
    expect(scalar(sqlite, "SELECT internal_notes, gst_number FROM contractor WHERE id = ?", [created.id])).toBe("Key holder");
    expect(await listContractors(database, "owner-b", true)).toEqual([]);
  });

  it("keeps historical pay when status and GST change, and blocks new assignments for non-schedulable statuses", async () => {
    const { database, sqlite } = await openMemoryDb();
    seedOwnerWorkspace(sqlite, "owner-a");
    const harbour = await createSite(database, "owner-a", { name: "Harbour", address: "" });
    const yard = await createSite(database, "owner-a", { name: "Yard", address: "" });
    const invited = await createContractor(database, "owner-a", {
      name: "Invited",
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      engagementStatus: "invited",
    });
    const draft = await createContractor(database, "owner-a", {
      name: "Draft",
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      engagementStatus: "draft",
    });
    const working = await createContractor(database, "owner-a", {
      name: "Working",
      email: "",
      phone: "",
      defaultRateCents: 3_200,
    });

    await createAssignment(database, "owner-a", { contractorId: invited.id, siteId: harbour.id, rateCents: null });
    await expect(createAssignment(database, "owner-a", { contractorId: draft.id, siteId: harbour.id, rateCents: null })).rejects.toThrow("not_found");
    const assignment = await createAssignment(database, "owner-a", { contractorId: working.id, siteId: harbour.id, rateCents: 3_500 });
    const entry = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: working.id,
      siteId: harbour.id,
      workDate: "2026-08-31",
      paidMinutes: 90,
      notes: "recorded",
    });
    const weekBefore = summarizeWeek([{
      contractorId: working.id,
      contractorName: "Working",
      paidMinutes: entry.paidMinutes,
      rateCents: entry.rateCents,
    }]);

    const suspended = await updateContractor(database, "owner-a", working.id, {
      name: "Working",
      email: "",
      phone: "",
      defaultRateCents: 4_500,
      engagementStatus: "suspended",
      gstRegistered: true,
      gstNumber: "12345678",
      internalNotes: "Paused",
    });
    expect(suspended).toMatchObject({
      engagementStatus: "suspended",
      active: false,
      gstRegistered: true,
      gstNumber: "12345678",
      defaultRateCents: 4_500,
    });
    expect(scalar(sqlite, "SELECT active FROM assignment WHERE id = ?", [assignment.id])).toBe(1);
    await expect(createAssignment(database, "owner-a", { contractorId: working.id, siteId: yard.id, rateCents: null })).rejects.toThrow("not_found");

    const storedRate = Number(scalar(sqlite, "SELECT rate_cents FROM time_entry WHERE id = ?", [entry.id]));
    const storedMinutes = Number(scalar(sqlite, "SELECT paid_minutes FROM time_entry WHERE id = ?", [entry.id]));
    expect(storedRate).toBe(entry.rateCents);
    expect(storedMinutes).toBe(90);
    expect(summarizeWeek([{
      contractorId: working.id,
      contractorName: "Working",
      paidMinutes: storedMinutes,
      rateCents: storedRate,
    }])).toEqual(weekBefore);
    expect(await getContractor(database, "owner-a", working.id)).toMatchObject({ internalNotes: "Paused" });

    const archived = await updateContractor(database, "owner-a", working.id, {
      name: "Working",
      email: "",
      phone: "",
      defaultRateCents: 4_500,
      engagementStatus: "archived",
    });
    expect(archived).toMatchObject({ engagementStatus: "archived", active: false });
    expect(scalar(sqlite, "SELECT active FROM assignment WHERE id = ?", [assignment.id])).toBe(0);
    const visible = await listContractors(database, "owner-a", false);
    expect(visible.map((row) => row.id).sort()).toEqual([draft.id, invited.id].sort());
    expect((await listContractors(database, "owner-a", true)).map((row) => row.id)).toContain(working.id);

    const restored = await restoreContractor(database, "owner-a", working.id);
    expect(restored).toMatchObject({ engagementStatus: "active", active: true, gstRegistered: true });
    expect(scalar(sqlite, "SELECT active FROM assignment WHERE id = ?", [assignment.id])).toBe(1);
    expect(scalar(sqlite, "SELECT rate_cents FROM time_entry WHERE id = ?", [entry.id])).toBe(entry.rateCents);

    const archivedAgain = await archiveContractor(database, "owner-a", working.id);
    expect(archivedAgain).toMatchObject({ engagementStatus: "archived", active: false });
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id = ?", [working.id])).toBe("archived");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM time_entry WHERE contractor_id = ?", [working.id])).toBe(1);
  });

  it("keeps notes, emergency contact, and GST number off dashboard and remittance payloads", async () => {
    const { database, sqlite } = await openMemoryDb();
    seedOwnerWorkspace(sqlite, "owner-a");
    const site = await createSite(database, "owner-a", { name: "Harbour", address: "" });
    const contractor = await createContractor(database, "owner-a", {
      name: "Aroha",
      email: "aroha@example.test",
      phone: "021000000",
      defaultRateCents: 3_200,
      gstRegistered: true,
      gstNumber: "123456789",
      internalNotes: "Key holder",
      emergencyContactName: "Sam",
      emergencyContactPhone: "021111111",
    });
    await createAssignment(database, "owner-a", { contractorId: contractor.id, siteId: site.id, rateCents: null });
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: contractor.id,
      siteId: site.id,
      workDate: "2026-08-31",
      paidMinutes: 60,
      notes: "",
    });
    const dashboard = await getDashboard(database, "owner-a", "2026-08-31");
    const remittance = await getContractorWeekRemittance(database, "owner-a", contractor.id, "2026-08-31");
    const encoded = JSON.stringify({ dashboard, remittance });
    expect(encoded).not.toMatch(/Key holder|021111111|123456789|internalNotes|emergencyContact|gstNumber/);
    expect(dashboard.contractors[0]).toMatchObject({ id: contractor.id, name: "Aroha" });
    expect(remittance.contractor).toEqual({ id: contractor.id, name: "Aroha" });
  });
});
