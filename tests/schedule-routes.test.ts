import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSrc(relative: string): string {
  return fs.readFileSync(path.resolve(relative), "utf8");
}

function exportedFunction(source: string, name: string): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `missing export ${name}`).toBeGreaterThan(-1);
  const after = start + marker.length;
  const next = source.slice(after).search(/\nexport async function /);
  return next === -1 ? source.slice(start) : source.slice(start, after + next);
}

describe("recurring schedule route contracts", () => {
  const scheduleRoute = readSrc("src/app/api/assignments/[id]/schedule/route.ts");
  const applyRoute = readSrc("src/app/api/weeks/apply-schedule/route.ts");
  const exceptionRoute = readSrc("src/app/api/time-entries/[id]/exception/route.ts");
  const dashboardRoute = readSrc("src/app/api/dashboard/route.ts");
  const assignmentIdRoute = readSrc("src/app/api/assignments/[id]/route.ts");
  const validation = readSrc("packages/core/src/validation.ts");
  const timesheet = readSrc("src/services/timesheet.ts");
  const schedule = readSrc("src/services/schedule.ts");

  const scheduleGet = exportedFunction(scheduleRoute, "GET");
  const schedulePut = exportedFunction(scheduleRoute, "PUT");
  const scheduleDelete = exportedFunction(scheduleRoute, "DELETE");
  const applyPost = exportedFunction(applyRoute, "POST");
  const exceptionPost = exportedFunction(exceptionRoute, "POST");
  const dashboardGet = exportedFunction(dashboardRoute, "GET");
  const assignmentPatch = exportedFunction(assignmentIdRoute, "PATCH");
  const getDashboard = exportedFunction(timesheet, "getDashboard");
  const createTimeEntry = exportedFunction(timesheet, "createTimeEntry");

  it("requires a trusted origin on schedule PUT/DELETE and apply/exception POSTs", () => {
    expect(schedulePut).toMatch(/authorize\(request,\s*true\)/);
    expect(scheduleDelete).toMatch(/authorize\(request,\s*true\)/);
    expect(applyPost).toMatch(/authorize\(request,\s*true\)/);
    expect(exceptionPost).toMatch(/authorize\(request,\s*true\)/);
  });

  it("keeps GET schedule and dashboard GET as non-mutation reads", () => {
    expect(scheduleGet).toMatch(/authorize\(request\)/);
    expect(scheduleGet).not.toMatch(/authorize\(request,\s*true\)/);
    expect(dashboardGet).toMatch(/authorize\(request\)/);
    expect(dashboardGet).not.toMatch(/authorize\(request,\s*true\)/);
  });

  it("does not accept owner_user_id in schedule validation objects", () => {
    const putSchema = validation.slice(validation.indexOf("export const schedulePutInput"));
    const deleteSchema = validation.slice(validation.indexOf("export const scheduleDeleteInput"));
    const applySchema = validation.slice(validation.indexOf("export const weekApplyScheduleInput"));
    const exceptionSchema = validation.slice(validation.indexOf("export const occurrenceExceptionInput"));
    for (const schema of [putSchema.slice(0, 900), deleteSchema.slice(0, 400), applySchema.slice(0, 400), exceptionSchema.slice(0, 900)]) {
      expect(schema).not.toMatch(/ownerUserId|owner_user_id/);
    }
    expect(scheduleRoute).not.toMatch(/owner_user_id|ownerUserId/);
    expect(applyRoute).not.toMatch(/owner_user_id|ownerUserId/);
    expect(exceptionRoute).not.toMatch(/owner_user_id|ownerUserId/);
  });

  it("maps week_locked, schedule_exists, no_schedule, and not_found", () => {
    expect(schedulePut).toMatch(/"schedule_exists"[\s\S]*409/);
    expect(schedulePut).toMatch(/"not_found"[\s\S]*404/);
    expect(schedulePut).toMatch(/"week_locked"[\s\S]*409/);
    expect(scheduleGet).toMatch(/"not_found"[\s\S]*404/);
    expect(scheduleDelete).toMatch(/"not_found"[\s\S]*404/);
    expect(exceptionPost).toMatch(/"no_schedule"[\s\S]*409/);
    expect(exceptionPost).toMatch(/"week_locked"[\s\S]*409/);
    expect(exceptionPost).toMatch(/"not_found"[\s\S]*404/);
    expect(applyPost).toMatch(/"week_locked"[\s\S]*409/);
  });

  it("returns invalid_week for a non-Monday weekStart on PUT, DELETE, and apply", () => {
    expect(schedulePut).toMatch(/invalid_week/);
    expect(scheduleDelete).toMatch(/invalid_week/);
    expect(applyPost).toMatch(/invalid_week/);
    expect(schedulePut).toMatch(/weekStartInput/);
    expect(scheduleDelete).toMatch(/weekStartInput/);
    expect(applyPost).toMatch(/weekStartInput/);
  });

  it("guards invalid assignment and entry ids the same way as existing [id] routes", () => {
    for (const source of [scheduleGet, schedulePut, scheduleDelete, exceptionPost]) {
      expect(source).toMatch(/!id\s*\|\|\s*id\.length\s*>\s*64/);
      expect(source).toMatch(/invalid_request/);
    }
  });

  it("leaves assignment PATCH rate-only and dashboard GET without writes", () => {
    expect(assignmentPatch).toMatch(/assignmentRateInput/);
    expect(assignmentPatch).not.toMatch(/schedulePutInput/);
    expect(getDashboard).not.toMatch(/insert\(\s*timeEntries/);
    expect(getDashboard).not.toMatch(/update\(\s*timeEntries/);
    expect(getDashboard).not.toMatch(/insert\(\s*assignmentScheduleVersions/);
    expect(getDashboard).not.toMatch(/update\(\s*assignmentScheduleVersions/);
  });

  it("snapshots manual occurrence on createTimeEntry and never posts scheduled from clients", () => {
    expect(createTimeEntry).toMatch(/occurrenceKind:\s*"manual"/);
    expect(createTimeEntry).toMatch(/scheduleVersionId:\s*null/);
    const paidHoursFields = validation.slice(
      validation.indexOf("const paidHoursEntryFields"),
      validation.indexOf("const assignSite"),
    );
    expect(paidHoursFields).toMatch(/paidMinutes:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(1439\)/);
    const timeEntrySchema = validation.slice(
      validation.indexOf("export const timeEntryInput"),
      validation.indexOf("export const timeEntryUpdateInput"),
    );
    expect(timeEntrySchema).not.toMatch(/occurrenceKind/);
    expect(timeEntrySchema).not.toMatch(/scheduled/);
    expect(timeEntrySchema).not.toMatch(/absent/);
  });

  it("scopes schedule reads and writes by session owner", () => {
    expect(schedule).toMatch(/eq\(assignments\.ownerUserId,\s*ownerUserId\)/);
    expect(schedule).toMatch(/eq\(assignmentScheduleVersions\.ownerUserId,\s*ownerUserId\)/);
    expect(schedule).toMatch(/eq\(timeEntries\.ownerUserId,\s*ownerUserId\)/);
    expect(schedule).toMatch(/eq\(contractors\.ownerUserId,\s*ownerUserId\)/);
    expect(schedule).toMatch(/eq\(sites\.ownerUserId,\s*ownerUserId\)/);
  });
});
