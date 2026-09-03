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

describe("time entry route contracts", () => {
  const idRoute = readSrc("src/app/api/time-entries/[id]/route.ts");
  const collectionRoute = readSrc("src/app/api/time-entries/route.ts");
  const dashboardRoute = readSrc("src/app/api/dashboard/route.ts");
  const timesheet = readSrc("src/services/timesheet.ts");

  const getById = exportedFunction(idRoute, "GET");
  const patchById = exportedFunction(idRoute, "PATCH");
  const deleteById = exportedFunction(idRoute, "DELETE");
  const postCollection = exportedFunction(collectionRoute, "POST");
  const dashboardGet = exportedFunction(dashboardRoute, "GET");
  const getTimeEntry = exportedFunction(timesheet, "getTimeEntry");
  const updateTimeEntry = exportedFunction(timesheet, "updateTimeEntry");
  const createTimeEntry = exportedFunction(timesheet, "createTimeEntry");

  it("GET by id authorizes without mutation CSRF; PATCH and DELETE require trusted origin", () => {
    expect(getById).toMatch(/authorize\(request\)/);
    expect(getById).not.toMatch(/authorize\(request,\s*true\)/);
    expect(patchById).toMatch(/authorize\(request,\s*true\)/);
    expect(deleteById).toMatch(/authorize\(request,\s*true\)/);
  });

  it("POST remains a mutation and dashboard GET remains a non-mutation read", () => {
    expect(postCollection).toMatch(/authorize\(request,\s*true\)/);
    expect(dashboardGet).toMatch(/authorize\(request\)/);
    expect(dashboardGet).not.toMatch(/authorize\(request,\s*true\)/);
  });

  it("maps not_found, invalid_shift, and duplicate_entry like POST", () => {
    for (const source of [patchById, postCollection]) {
      expect(source).toMatch(/"not_found"[\s\S]*404/);
      expect(source).toMatch(/"invalid_shift"[\s\S]*400/);
      expect(source).toMatch(/"duplicate_entry"[\s\S]*409/);
    }
  });

  it("scopes getTimeEntry and updateTimeEntry by owner, including contractor and site joins", () => {
    expect(getTimeEntry).toMatch(/eq\(timeEntries\.ownerUserId,\s*ownerUserId\)/);
    expect(getTimeEntry).toMatch(/eq\(contractors\.ownerUserId,\s*ownerUserId\)/);
    expect(getTimeEntry).toMatch(/eq\(sites\.ownerUserId,\s*ownerUserId\)/);
    expect(getTimeEntry).toMatch(/contractorName:\s*contractors\.name/);
    expect(getTimeEntry).toMatch(/siteName:\s*sites\.name/);

    expect(updateTimeEntry).toMatch(/eq\(timeEntries\.ownerUserId,\s*ownerUserId\)/);
    expect(updateTimeEntry).toMatch(/eq\(contractors\.ownerUserId,\s*ownerUserId\)/);
    expect(updateTimeEntry).toMatch(/eq\(sites\.ownerUserId,\s*ownerUserId\)/);
  });

  it("excludes the current id from the update duplicate lookup and sets updatedAt", () => {
    expect(updateTimeEntry).toMatch(/ne\(timeEntries\.id/);
    expect(updateTimeEntry).toMatch(/updatedAt/);
  });

  it("does not create assignments on update; POST still uses create input with optional assignSite", () => {
    expect(updateTimeEntry).not.toMatch(/createAssignment/);
    expect(patchById).not.toMatch(/createAssignment/);
    expect(patchById).toMatch(/timeEntryUpdateInput/);
    expect(postCollection).toMatch(/timeEntryInput/);
    expect(createTimeEntry).toMatch(/applyInlineAssignSiteAfterPrecheck/);
  });

  it("GET by id and PATCH share the same invalid id guard as DELETE", () => {
    for (const source of [getById, patchById, deleteById]) {
      expect(source).toMatch(/!id\s*\|\|\s*id\.length\s*>\s*64/);
      expect(source).toMatch(/invalid_request/);
    }
  });
});
