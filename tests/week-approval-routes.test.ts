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

describe("week approval route contracts", () => {
  const approveRoute = readSrc("src/app/api/weeks/approve/route.ts");
  const reopenRoute = readSrc("src/app/api/weeks/reopen/route.ts");
  const dashboardRoute = readSrc("src/app/api/dashboard/route.ts");
  const collectionRoute = readSrc("src/app/api/time-entries/route.ts");
  const idRoute = readSrc("src/app/api/time-entries/[id]/route.ts");
  const validation = readSrc("src/lib/validation.ts");
  const weekApproval = readSrc("src/services/week-approval.ts");
  const timesheet = readSrc("src/services/timesheet.ts");

  const approvePost = exportedFunction(approveRoute, "POST");
  const reopenPost = exportedFunction(reopenRoute, "POST");
  const dashboardGet = exportedFunction(dashboardRoute, "GET");
  const timeEntryPost = exportedFunction(collectionRoute, "POST");
  const timeEntryPatch = exportedFunction(idRoute, "PATCH");
  const timeEntryDelete = exportedFunction(idRoute, "DELETE");
  const createTimeEntry = exportedFunction(timesheet, "createTimeEntry");
  const updateTimeEntry = exportedFunction(timesheet, "updateTimeEntry");
  const deleteTimeEntry = exportedFunction(timesheet, "deleteTimeEntry");
  const getDashboard = exportedFunction(timesheet, "getDashboard");

  it("requires a trusted origin on approve and reopen cookie mutations", () => {
    expect(approvePost).toMatch(/authorize\(request,\s*true\)/);
    expect(reopenPost).toMatch(/authorize\(request,\s*true\)/);
  });

  it("keeps dashboard GET as a non-mutation read", () => {
    expect(dashboardGet).toMatch(/authorize\(request\)/);
    expect(dashboardGet).not.toMatch(/authorize\(request,\s*true\)/);
  });

  it("does not accept owner_user_id in approve or reopen validation or handlers", () => {
    expect(validation).toMatch(/export const weekApproveInput/);
    expect(validation).toMatch(/export const weekReopenInput/);
    const approveSchema = validation.slice(validation.indexOf("export const weekApproveInput"));
    const reopenSchema = validation.slice(validation.indexOf("export const weekReopenInput"));
    expect(approveSchema).not.toMatch(/ownerUserId|owner_user_id/);
    expect(reopenSchema.slice(0, 400)).not.toMatch(/ownerUserId|owner_user_id/);
    expect(approveRoute).not.toMatch(/owner_user_id|ownerUserId/);
    expect(reopenRoute).not.toMatch(/owner_user_id|ownerUserId/);
  });

  it("maps stale_week, week_not_approved, and week_locked to 409", () => {
    expect(approvePost).toMatch(/"stale_week"[\s\S]*409/);
    expect(reopenPost).toMatch(/"week_not_approved"[\s\S]*409/);
    expect(timeEntryPost).toMatch(/"week_locked"[\s\S]*409/);
    expect(timeEntryPatch).toMatch(/"week_locked"[\s\S]*409/);
    expect(timeEntryDelete).toMatch(/"week_locked"[\s\S]*409/);
  });

  it("returns invalid_week for a non-Monday on approve and reopen", () => {
    expect(approvePost).toMatch(/invalid_week/);
    expect(reopenPost).toMatch(/invalid_week/);
    expect(approvePost).toMatch(/weekStartInput|weekApproveInput/);
    expect(reopenPost).toMatch(/weekReopenInput|weekStartInput/);
  });

  it("locks time-entry writes after clock validation and before inline assignSite", () => {
    const clockAt = createTimeEntry.indexOf("clockFieldsForWrite");
    const lockAt = createTimeEntry.indexOf("assertUnlockedWeek");
    const assignAt = createTimeEntry.indexOf("applyInlineAssignSiteAfterPrecheck");
    expect(clockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeGreaterThan(clockAt);
    expect(assignAt).toBeGreaterThan(lockAt);
    expect(updateTimeEntry).toMatch(/assertUnlockedWeek/);
    expect(updateTimeEntry).toMatch(/existing\.workDate/);
    expect(updateTimeEntry).toMatch(/input\.workDate/);
    expect(deleteTimeEntry).toMatch(/assertUnlockedWeek/);
    expect(deleteTimeEntry).toMatch(/eq\(timeEntries\.ownerUserId,\s*ownerUserId\)/);
  });

  it("adds dashboard approval without exposing id or ownerUserId", () => {
    expect(getDashboard).toMatch(/approval:/);
    expect(getDashboard).toMatch(/findWeekApproval/);
    expect(getDashboard).not.toMatch(/approval:[\s\S]*ownerUserId/);
  });

  it("does not persist pay copies or rewrite time_entry.rate_cents on approve or reopen", () => {
    expect(weekApproval).not.toMatch(/\.update\(\s*timeEntries\s*\)/);
    expect(weekApproval).not.toMatch(/\.insert\(\s*timeEntries\s*\)/);
    expect(weekApproval).not.toMatch(/\.set\(\s*\{[\s\S]*rateCents/);
    expect(weekApproval).not.toMatch(/insert\(weekApprovals\)[\s\S]*paidMinutes|insert\(weekApprovals\)[\s\S]*payCents|insert\(weekApprovals\)[\s\S]*rateCents/);
  });
});
