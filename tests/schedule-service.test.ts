import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import { eq } from "drizzle-orm";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { assignmentScheduleVersions, ownerTimeEntryAudit, timeEntries } from "../src/db/schema";
import { calculateEntryPayCents, summarizeWeek } from "../src/lib/payroll";
import { createSite } from "../src/services/sites";
import { execContractorEngagementMigration, seedOwnerWorkspace } from "./owner-workspace";
import {
  applyOccurrenceException,
  applyScheduleToWeek,
  deleteAssignmentSchedule,
  getAssignmentSchedule,
  putAssignmentSchedule,
} from "../src/services/schedule";
import {
  createAssignment,
  createContractor,
  createTimeEntry,
  getAssignment,
  getDashboard,
  listAssignments,
  unassignAssignment,
  updateAssignmentRate,
  updateTimeEntry,
} from "../src/services/timesheet";
import { approveWeek } from "../src/services/week-approval";

type TimesheetDb = Parameters<typeof getDashboard>[0];

const MONDAY = "2026-08-31";
const TUESDAY = "2026-09-01";
const WEDNESDAY = "2026-09-02";
const NEXT_MONDAY = "2026-09-07";
const WEEKDAYS = [1, 2, 3, 4, 5];
const PAID = 90;
const RATE = 2_000;

function exportedFunction(source: string, name: string): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  const after = start + marker.length;
  const next = source.slice(after).search(/\nexport async function /);
  return next === -1 ? source.slice(start) : source.slice(start, after + next);
}

async function openMemoryDb() {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0000_initial.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0001_entry_mode.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0002_week_approval.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0003_recurring_schedules.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0004_business_workspace.sql"), "utf8"));
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0009_owner_time_entry_audit.sql"), "utf8"));
  execContractorEngagementMigration(sqlite);
  const database = drizzle(sqlite) as unknown as TimesheetDb;
  return { sqlite, database };
}

function insertUser(sqlite: SqlJsDatabase, id: string) {
  seedOwnerWorkspace(sqlite, id);
}

async function seedOwner(
  database: TimesheetDb,
  sqlite: SqlJsDatabase,
  ownerUserId: string,
  names = { contractor: `${ownerUserId}-pasindhu`, site: `${ownerUserId}-whitford` },
) {
  insertUser(sqlite, ownerUserId);
  const site = await createSite(database, ownerUserId, { name: names.site, address: "" });
  const contractor = await createContractor(database, ownerUserId, {
    name: names.contractor,
    email: "",
    phone: "",
    defaultRateCents: RATE,
  });
  const assignment = await createAssignment(database, ownerUserId, {
    contractorId: contractor.id,
    siteId: site.id,
    rateCents: RATE,
  });
  return { contractor, site, assignment };
}

async function seedFixture() {
  const { sqlite, database } = await openMemoryDb();
  const owner = await seedOwner(database, sqlite, "owner-a", { contractor: "Pasindhu", site: "Whitford" });
  return { sqlite, database, owner };
}

const createSchedule = {
  weekdays: WEEKDAYS,
  paidMinutes: PAID,
  weekStart: MONDAY,
  mode: "create" as const,
};

async function ownerEntries(database: TimesheetDb, ownerUserId: string) {
  return database.select().from(timeEntries).where(eq(timeEntries.ownerUserId, ownerUserId));
}

describe("recurring schedule service", () => {
  it("applies a Mon–Fri 90-minute week and leaves GET dashboard as a read", async () => {
    const { database, owner } = await seedFixture();
    const created = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    expect(created).toMatchObject({
      weekdays: WEEKDAYS,
      paidMinutes: PAID,
      effectiveFrom: MONDAY,
    });
    expect(created).not.toHaveProperty("ownerUserId");

    const assigned = await getAssignment(database, "owner-a", owner.assignment.id);
    expect(assigned.schedule).toEqual({
      id: created.id,
      weekdays: WEEKDAYS,
      paidMinutes: PAID,
      effectiveFrom: MONDAY,
    });

    const rows = await ownerEntries(database, "owner-a");
    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.paidMinutes === 90 && row.occurrenceKind === "scheduled" && row.rateCents === RATE)).toBe(true);
    const summary = summarizeWeek(rows.map((row) => ({
      contractorId: row.contractorId,
      contractorName: "Pasindhu",
      paidMinutes: row.paidMinutes,
      rateCents: row.rateCents,
    })));
    expect(summary).toEqual([{ contractorId: owner.contractor.id, contractorName: "Pasindhu", paidMinutes: 450, payCents: 15_000 }]);
    expect(summary[0]?.payCents).toBe(calculateEntryPayCents(90, RATE) * 5);

    const dashboard = await getDashboard(database, "owner-a", MONDAY);
    expect(dashboard.entries).toHaveLength(5);
    expect(dashboard.summary).toEqual([{ contractorId: owner.contractor.id, contractorName: "Pasindhu", paidMinutes: 450, payCents: 15_000 }]);
    expect(dashboard.assignments[0]?.schedule).toEqual({
      id: created.id,
      weekdays: WEEKDAYS,
      paidMinutes: PAID,
      effectiveFrom: MONDAY,
    });
    expect(dashboard.entries[0]).toMatchObject({ occurrenceKind: "scheduled", scheduleVersionId: created.id });

    const again = await getDashboard(database, "owner-a", MONDAY);
    expect(again.entries).toHaveLength(5);
    expect(await ownerEntries(database, "owner-a")).toHaveLength(5);
  });

  it("marks Monday absent at 0/$0 without changing the version mask, and next week still includes Monday", async () => {
    const { database, owner } = await seedFixture();
    const created = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY);
    expect(monday).toBeTruthy();
    const absent = await applyOccurrenceException(database, "owner-a", monday!.id, {
      kind: "absent",
      scope: "this_day",
    });
    expect(absent).toMatchObject({
      occurrenceKind: "absent",
      entryMode: "absent",
      paidMinutes: 0,
      startMinutes: 0,
      endMinutes: 0,
      breakMinutes: 0,
      rateCents: RATE,
    });

    const week = await ownerEntries(database, "owner-a");
    expect(week.find((row) => row.workDate === MONDAY)?.paidMinutes).toBe(0);
    expect(week.filter((row) => row.workDate !== MONDAY).every((row) => row.paidMinutes === 90)).toBe(true);
    const dashboard = await getDashboard(database, "owner-a", MONDAY);
    expect(dashboard.summary[0]).toMatchObject({ paidMinutes: 360, payCents: 12_000 });

    const schedule = await getAssignmentSchedule(database, "owner-a", owner.assignment.id);
    expect(schedule.current).toMatchObject({ id: created.id, weekdays: WEEKDAYS, paidMinutes: 90 });
    expect(schedule.versions).toHaveLength(1);
    expect(schedule).not.toHaveProperty("ownerUserId");
    expect(JSON.stringify(schedule)).not.toMatch(/ownerUserId|owner_user_id/);

    const next = await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY);
    expect(next.inserted).toBe(5);
    const nextMonday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === NEXT_MONDAY);
    expect(nextMonday).toMatchObject({ occurrenceKind: "scheduled", paidMinutes: 90 });
  });

  it("overrides Wednesday this day only and leaves the version and next week at 90", async () => {
    const { database, owner } = await seedFixture();
    const created = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const wednesday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === WEDNESDAY);
    const overridden = await applyOccurrenceException(database, "owner-a", wednesday!.id, {
      kind: "hours_override",
      scope: "this_day",
      paidMinutes: 120,
    });
    expect(overridden).toMatchObject({
      occurrenceKind: "hours_override",
      entryMode: "paid_hours",
      paidMinutes: 120,
      rateCents: RATE,
      scheduleVersionId: created.id,
    });
    const week = await ownerEntries(database, "owner-a");
    expect(week.find((row) => row.workDate === WEDNESDAY)?.paidMinutes).toBe(120);
    expect(week.filter((row) => row.workDate !== WEDNESDAY).every((row) => row.paidMinutes === 90)).toBe(true);

    const schedule = await getAssignmentSchedule(database, "owner-a", owner.assignment.id);
    expect(schedule.current?.paidMinutes).toBe(90);

    await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY);
    const nextWednesday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === "2026-09-09");
    expect(nextWednesday).toMatchObject({ paidMinutes: 90, occurrenceKind: "scheduled" });
  });

  it("going-forward Monday 90→60 leaves prior week minutes and rates, and does not touch exceptions", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY);

    const week2 = (await ownerEntries(database, "owner-a")).filter((row) => row.workDate >= NEXT_MONDAY);
    const tuesday = week2.find((row) => row.workDate === "2026-09-08")!;
    const wednesday = week2.find((row) => row.workDate === "2026-09-09")!;
    await applyOccurrenceException(database, "owner-a", tuesday.id, { kind: "absent", scope: "this_day" });
    await applyOccurrenceException(database, "owner-a", wednesday.id, {
      kind: "hours_override",
      scope: "this_day",
      paidMinutes: 120,
    });
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: "2026-09-12",
      paidMinutes: 30,
      notes: "manual Saturday",
    });

    const prior = (await ownerEntries(database, "owner-a"))
      .filter((row) => row.workDate >= MONDAY && row.workDate < NEXT_MONDAY)
      .map((row) => ({ id: row.id, paidMinutes: row.paidMinutes, rateCents: row.rateCents }));

    await updateAssignmentRate(database, "owner-a", owner.assignment.id, { rateCents: 2_500 });
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, {
      weekdays: WEEKDAYS,
      paidMinutes: 60,
      weekStart: NEXT_MONDAY,
      mode: "going_forward",
    });

    const afterPrior = (await ownerEntries(database, "owner-a"))
      .filter((row) => row.workDate >= MONDAY && row.workDate < NEXT_MONDAY);
    expect(afterPrior.map((row) => ({ id: row.id, paidMinutes: row.paidMinutes, rateCents: row.rateCents }))).toEqual(prior);
    expect(afterPrior.every((row) => row.rateCents === RATE && row.paidMinutes === 90)).toBe(true);

    const afterFuture = await ownerEntries(database, "owner-a");
    expect(afterFuture.find((row) => row.workDate === NEXT_MONDAY)).toMatchObject({
      paidMinutes: 60,
      occurrenceKind: "scheduled",
      rateCents: RATE,
    });
    expect(afterFuture.find((row) => row.workDate === "2026-09-08")).toMatchObject({
      occurrenceKind: "absent",
      paidMinutes: 0,
      rateCents: RATE,
    });
    expect(afterFuture.find((row) => row.workDate === "2026-09-09")).toMatchObject({
      occurrenceKind: "hours_override",
      paidMinutes: 120,
      rateCents: RATE,
    });
    expect(afterFuture.find((row) => row.workDate === "2026-09-12")).toMatchObject({
      occurrenceKind: "manual",
      paidMinutes: 30,
      rateCents: RATE,
    });
    expect(afterFuture.find((row) => row.workDate === "2026-09-10")).toMatchObject({ paidMinutes: 60, occurrenceKind: "scheduled" });
  });

  it("lets one-off creates work without a schedule and skips existing rows on apply", async () => {
    const { database, owner } = await seedFixture();
    const oneOff = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: MONDAY,
      paidMinutes: 45,
      notes: "irregular",
    });
    expect(oneOff).toMatchObject({ occurrenceKind: "manual", scheduleVersionId: null, paidMinutes: 45 });

    const created = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    expect(created.id).toBeTruthy();
    const rows = await ownerEntries(database, "owner-a");
    expect(rows).toHaveLength(5);
    expect(rows.find((row) => row.workDate === MONDAY)).toMatchObject({
      id: oneOff.id,
      occurrenceKind: "manual",
      paidMinutes: 45,
    });
    expect(rows.filter((row) => row.occurrenceKind === "scheduled")).toHaveLength(4);

    const applyAgain = await applyScheduleToWeek(database, "owner-a", MONDAY);
    expect(applyAgain.inserted).toBe(0);

    await expect(createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: TUESDAY,
      paidMinutes: 45,
      notes: "",
    })).rejects.toThrow("duplicate_entry");
  });

  it("keeps existing rate snapshots after a rate change and snapshots the new rate on a later apply", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const first = await ownerEntries(database, "owner-a");
    expect(first.every((row) => row.rateCents === RATE)).toBe(true);

    await updateAssignmentRate(database, "owner-a", owner.assignment.id, { rateCents: 2_500 });
    const afterRate = await ownerEntries(database, "owner-a");
    expect(afterRate.every((row) => row.rateCents === RATE)).toBe(true);

    const later = await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY);
    expect(later.inserted).toBe(5);
    const nextWeek = (await ownerEntries(database, "owner-a")).filter((row) => row.workDate >= NEXT_MONDAY);
    expect(nextWeek.every((row) => row.rateCents === 2_500 && row.paidMinutes === 90)).toBe(true);
    expect((await ownerEntries(database, "owner-a")).filter((row) => row.workDate < NEXT_MONDAY).every((row) => row.rateCents === RATE)).toBe(true);
  });

  it("skips approved weeks on apply and exception, and going-forward from next Monday does not rewrite locked rows", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const locked = await ownerEntries(database, "owner-a");
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 450,
      expectedPayCents: 15_000,
    });

    expect(await applyScheduleToWeek(database, "owner-a", MONDAY)).toEqual({ weekStart: MONDAY, inserted: 0 });
    await expect(applyOccurrenceException(database, "owner-a", locked[0]!.id, {
      kind: "absent",
      scope: "this_day",
    })).rejects.toThrow("week_locked");

    const snapshot = locked.map((row) => ({
      id: row.id,
      paidMinutes: row.paidMinutes,
      rateCents: row.rateCents,
      occurrenceKind: row.occurrenceKind,
      scheduleVersionId: row.scheduleVersionId,
    }));
    const going = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, {
      weekdays: WEEKDAYS,
      paidMinutes: 60,
      weekStart: NEXT_MONDAY,
      mode: "going_forward",
    });
    expect(going.paidMinutes).toBe(60);
    expect(going.effectiveFrom).toBe(NEXT_MONDAY);

    const stillLocked = (await ownerEntries(database, "owner-a"))
      .filter((row) => row.workDate >= MONDAY && row.workDate < NEXT_MONDAY);
    expect(stillLocked.map((row) => ({
      id: row.id,
      paidMinutes: row.paidMinutes,
      rateCents: row.rateCents,
      occurrenceKind: row.occurrenceKind,
      scheduleVersionId: row.scheduleVersionId,
    }))).toEqual(snapshot);
  });

  it("rejects confirm, reset, and hour changes on an approved week", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 450,
      expectedPayCents: 15_000,
    });
    const before = await ownerEntries(database, "owner-a");
    await expect(applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "confirm_worked",
      scope: "this_day",
    })).rejects.toThrow("week_locked");
    await expect(applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "hours_override",
      scope: "this_day",
      paidMinutes: 30,
    })).rejects.toThrow("week_locked");
    const unchanged = await applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "worked_as_scheduled",
      scope: "this_day",
    });
    expect(unchanged).toMatchObject({ occurrenceKind: "scheduled", paidMinutes: 90, rateCents: RATE });
    expect(await ownerEntries(database, "owner-a")).toEqual(before);
  });

  it("confirms a scheduled day as worked and reset returns it to pending", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    const confirmed = await applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "confirm_worked",
      scope: "this_day",
    });
    expect(confirmed).toMatchObject({
      occurrenceKind: "worked",
      entryMode: "paid_hours",
      paidMinutes: 90,
      rateCents: RATE,
      scheduleVersionId: monday.scheduleVersionId,
    });
    const again = await applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "confirm_worked",
      scope: "this_day",
    });
    expect(again.occurrenceKind).toBe("worked");
    const reset = await applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "worked_as_scheduled",
      scope: "this_day",
    });
    expect(reset).toMatchObject({ occurrenceKind: "scheduled", paidMinutes: 90, rateCents: RATE });
  });

  it("atomically records the authenticated owner and old/new pay state for a same-day change", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;

    await applyOccurrenceException(database, "owner-a", monday.id, { kind: "absent", scope: "this_day" });

    const [audit] = await database.select().from(ownerTimeEntryAudit);
    expect(audit).toMatchObject({
      ownerUserId: "owner-a",
      actorUserId: "owner-a",
      businessId: "biz_owner-a",
      entryId: monday.id,
      action: "absent",
    });
    expect(JSON.parse(audit!.oldJson)).toEqual({
      occurrenceKind: "scheduled",
      entryMode: "paid_hours",
      paidMinutes: 90,
      startMinutes: 0,
      endMinutes: 90,
      breakMinutes: 0,
      scheduleVersionId: monday.scheduleVersionId,
    });
    expect(JSON.parse(audit!.newJson)).toEqual({
      occurrenceKind: "absent",
      entryMode: "absent",
      paidMinutes: 0,
      startMinutes: 0,
      endMinutes: 0,
      breakMinutes: 0,
      scheduleVersionId: monday.scheduleVersionId,
    });
    expect(audit!.oldJson).not.toMatch(/notes|contractor|rate/i);
    expect(audit!.newJson).not.toMatch(/notes|contractor|rate/i);
  });

  it("fails closed without changing pay when the owner audit insert is rejected", async () => {
    const { sqlite, database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    sqlite.exec(`CREATE TRIGGER reject_owner_time_entry_audit
      BEFORE INSERT ON owner_time_entry_audit BEGIN SELECT RAISE(ABORT, 'audit_rejected'); END;`);

    await expect(applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "absent",
      scope: "this_day",
    })).rejects.toThrow("audit_rejected");

    const kept = (await ownerEntries(database, "owner-a")).find((row) => row.id === monday.id);
    expect(kept).toMatchObject({ occurrenceKind: "scheduled", paidMinutes: 90, rateCents: RATE });
    expect(await database.select().from(ownerTimeEntryAudit)).toEqual([]);
  });

  it("rejects reset and absence once a confirmed day is on an approved week", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    await applyOccurrenceException(database, "owner-a", monday.id, { kind: "confirm_worked", scope: "this_day" });
    await approveWeek(database, "owner-a", {
      weekStart: MONDAY,
      expectedPaidMinutes: 450,
      expectedPayCents: 15_000,
    });
    await expect(applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "worked_as_scheduled",
      scope: "this_day",
    })).rejects.toThrow("week_locked");
    await expect(applyOccurrenceException(database, "owner-a", monday.id, {
      kind: "absent",
      scope: "this_day",
    })).rejects.toThrow("week_locked");
    const kept = (await ownerEntries(database, "owner-a")).find((row) => row.id === monday.id);
    expect(kept).toMatchObject({ occurrenceKind: "worked", paidMinutes: 90, rateCents: RATE });
  });

  it("keeps a confirmed worked day when a later schedule rewrites pending rows", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === NEXT_MONDAY)!;
    await applyOccurrenceException(database, "owner-a", monday.id, { kind: "confirm_worked", scope: "this_day" });
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, {
      weekdays: WEEKDAYS,
      paidMinutes: 60,
      weekStart: NEXT_MONDAY,
      mode: "going_forward",
    });
    const after = await ownerEntries(database, "owner-a");
    expect(after.find((row) => row.workDate === NEXT_MONDAY)).toMatchObject({
      occurrenceKind: "worked",
      paidMinutes: 90,
      rateCents: RATE,
    });
    expect(after.find((row) => row.workDate === "2026-09-08")).toMatchObject({
      occurrenceKind: "scheduled",
      paidMinutes: 60,
    });
  });

  it("skips archived assignments on apply and leaves old entries in place", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    expect(await unassignAssignment(database, "owner-a", owner.assignment.id)).toBe(true);
    const remaining = await ownerEntries(database, "owner-a");
    expect(remaining).toHaveLength(5);
    expect(await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY)).toEqual({
      weekStart: NEXT_MONDAY,
      inserted: 0,
    });
    expect(await ownerEntries(database, "owner-a")).toHaveLength(5);
    expect((await ownerEntries(database, "owner-a")).every((row) => remaining.some((kept) => kept.id === row.id))).toBe(true);
  });

  it("rejects a second create while an open version exists", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    await expect(putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule)).rejects.toThrow("schedule_exists");
  });

  it("rejects an exception on a manual entry as no_schedule", async () => {
    const { database, owner } = await seedFixture();
    const manual = await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: MONDAY,
      paidMinutes: 90,
      notes: "",
    });
    await expect(applyOccurrenceException(database, "owner-a", manual.id, {
      kind: "absent",
      scope: "this_day",
    })).rejects.toThrow("no_schedule");
  });

  it("hides another owner's schedule, apply, and exception behind not_found", async () => {
    const { sqlite, database, owner } = await seedFixture();
    const created = await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    const other = await seedOwner(database, sqlite, "owner-b");
    await putAssignmentSchedule(database, "owner-b", other.assignment.id, {
      ...createSchedule,
      paidMinutes: 60,
    });

    const before = (await ownerEntries(database, "owner-a")).map((row) => ({
      id: row.id,
      paidMinutes: row.paidMinutes,
      occurrenceKind: row.occurrenceKind,
    }));

    await expect(getAssignmentSchedule(database, "owner-b", owner.assignment.id)).rejects.toThrow("not_found");
    await expect(putAssignmentSchedule(database, "owner-b", owner.assignment.id, {
      weekdays: WEEKDAYS,
      paidMinutes: 30,
      weekStart: NEXT_MONDAY,
      mode: "going_forward",
    })).rejects.toThrow("not_found");
    await expect(deleteAssignmentSchedule(database, "owner-b", owner.assignment.id, { weekStart: NEXT_MONDAY })).rejects.toThrow("not_found");
    await expect(applyOccurrenceException(database, "owner-b", monday.id, {
      kind: "absent",
      scope: "this_day",
    })).rejects.toThrow("not_found");
    expect(await database.select().from(ownerTimeEntryAudit)).toEqual([]);

    const bApply = await applyScheduleToWeek(database, "owner-b", MONDAY);
    expect(bApply.inserted).toBe(0);
    const aAfter = (await ownerEntries(database, "owner-a")).map((row) => ({
      id: row.id,
      paidMinutes: row.paidMinutes,
      occurrenceKind: row.occurrenceKind,
    }));
    expect(aAfter).toEqual(before);
    expect((await getAssignmentSchedule(database, "owner-a", owner.assignment.id)).current?.id).toBe(created.id);
    const listed = await listAssignments(database, "owner-a");
    expect(listed.map((row) => row.id)).toContain(owner.assignment.id);
    expect(listed.map((row) => row.id)).not.toContain(other.assignment.id);
    const businessIds = sqlite.exec("SELECT DISTINCT business_id FROM assignment_schedule_version ORDER BY business_id")[0]?.values.map((row) => row[0]);
    expect(businessIds).toEqual(["biz_owner-a", "biz_owner-b"]);
  });

  it("does not insert or update time entries or schedule versions from getDashboard", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const entriesBefore = await ownerEntries(database, "owner-a");
    const versionsBefore = await database.select().from(assignmentScheduleVersions);
    await getDashboard(database, "owner-a", MONDAY);
    await getDashboard(database, "owner-a", NEXT_MONDAY);
    expect(await ownerEntries(database, "owner-a")).toEqual(entriesBefore);
    expect(await database.select().from(assignmentScheduleVersions)).toEqual(versionsBefore);

    const source = fs.readFileSync(path.resolve("src/services/timesheet.ts"), "utf8");
    const getDashboardSrc = exportedFunction(source, "getDashboard");
    expect(getDashboardSrc).not.toMatch(/insert\(\s*timeEntries/);
    expect(getDashboardSrc).not.toMatch(/update\(\s*timeEntries/);
    expect(getDashboardSrc).not.toMatch(/insert\(\s*assignmentScheduleVersions/);
    expect(getDashboardSrc).not.toMatch(/update\(\s*assignmentScheduleVersions/);
  });

  it("turns a duration PATCH of a scheduled row into hours_override without rewriting rate_cents", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    await updateAssignmentRate(database, "owner-a", owner.assignment.id, { rateCents: 2_500 });
    const updated = await updateTimeEntry(database, "owner-a", monday.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: MONDAY,
      paidMinutes: 120,
      notes: "",
    });
    expect(updated).toMatchObject({
      occurrenceKind: "hours_override",
      paidMinutes: 120,
      rateCents: RATE,
      scheduleVersionId: monday.scheduleVersionId,
    });
  });

  it("turns a duration PATCH of a confirmed worked row into hours_override", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    await applyOccurrenceException(database, "owner-a", monday.id, { kind: "confirm_worked", scope: "this_day" });
    const updated = await updateTimeEntry(database, "owner-a", monday.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: owner.site.id,
      workDate: MONDAY,
      paidMinutes: 75,
      notes: "",
    });
    expect(updated).toMatchObject({
      occurrenceKind: "hours_override",
      paidMinutes: 75,
      rateCents: RATE,
    });
  });

  it("reclassifying contractor/site snapshots rate and clears schedule provenance to manual", async () => {
    const { sqlite, database, owner } = await seedFixture();
    const otherSite = await createSite(database, "owner-a", { name: "Beachlands", address: "" });
    const otherAssignment = await createAssignment(database, "owner-a", {
      contractorId: owner.contractor.id,
      siteId: otherSite.id,
      rateCents: 2_200,
    });
    expect(otherAssignment.id).toBeTruthy();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    const monday = (await ownerEntries(database, "owner-a")).find((row) => row.workDate === MONDAY)!;
    const updated = await updateTimeEntry(database, "owner-a", monday.id, {
      entryMode: "paid_hours",
      contractorId: owner.contractor.id,
      siteId: otherSite.id,
      workDate: MONDAY,
      paidMinutes: 90,
      notes: "",
    });
    expect(updated).toMatchObject({
      occurrenceKind: "manual",
      scheduleVersionId: null,
      rateCents: 2_200,
      siteId: otherSite.id,
    });
    sqlite.close();
  });

  it("closes an open version on delete without deleting time entries", async () => {
    const { database, owner } = await seedFixture();
    await putAssignmentSchedule(database, "owner-a", owner.assignment.id, createSchedule);
    expect(await deleteAssignmentSchedule(database, "owner-a", owner.assignment.id, { weekStart: NEXT_MONDAY })).toEqual({ ok: true });
    const schedule = await getAssignmentSchedule(database, "owner-a", owner.assignment.id);
    expect(schedule.current).toBeNull();
    expect(schedule.versions[0]?.effectiveTo).toBe("2026-09-06");
    expect(await ownerEntries(database, "owner-a")).toHaveLength(5);
    expect(await applyScheduleToWeek(database, "owner-a", NEXT_MONDAY)).toEqual({
      weekStart: NEXT_MONDAY,
      inserted: 0,
    });
  });
});
