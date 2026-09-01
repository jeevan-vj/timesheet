import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contractorUpdateWriteSet } from "../src/lib/contractor-lifecycle";
import { calculateEntryPayCents, summarizeWeek } from "../src/lib/payroll";

function functionBody(source: string, name: string): string {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const nextExport = source.indexOf("\nexport ", start + marker.length);
  return nextExport < 0 ? source.slice(start) : source.slice(start, nextExport);
}

const timesheetSource = fs.readFileSync(path.resolve("src/services/timesheet.ts"), "utf8");

describe("contractor mutations preserve snapshotted pay", () => {
  it("does not change in-memory entry rate_cents when the default rate or active flag changes", () => {
    const entries = [
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 120, rateCents: 3_000 },
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 90, rateCents: 3_200 },
    ];
    const snapshot = entries.map((entry) => ({ ...entry }));

    contractorUpdateWriteSet({ name: "Aroha", email: "", phone: "", defaultRateCents: 4_500 }, new Date());
    const archived = { active: false };
    const restored = { active: true };
    expect(archived.active).toBe(false);
    expect(restored.active).toBe(true);
    expect(entries).toEqual(snapshot);
    expect(summarizeWeek(entries)).toEqual([
      { contractorId: "c1", contractorName: "Aroha", paidMinutes: 210, payCents: calculateEntryPayCents(120, 3_000) + calculateEntryPayCents(90, 3_200) },
    ]);
  });

  it("does not rewrite time entries from contractor create, update, archive, or restore", () => {
    for (const name of ["createContractor", "updateContractor", "archiveContractor", "restoreContractor"]) {
      const body = functionBody(timesheetSource, name);
      expect(body).not.toMatch(/timeEntries/);
      expect(body).not.toMatch(/\.update\(\s*timeEntries\s*\)/);
      expect(body).not.toMatch(/rateCents:/);
    }
  });

  it("keeps dashboard assignment selects on active contractors while time-entry joins ignore active", () => {
    const dashboard = functionBody(timesheetSource, "getDashboard");
    expect(dashboard).toMatch(/from\(\s*assignments\s*\)[\s\S]*innerJoin\(\s*contractors[\s\S]*eq\(\s*contractors\.active,\s*true\s*\)/);
    const entryJoin = dashboard.slice(dashboard.indexOf("from(timeEntries)"));
    expect(entryJoin).toMatch(/innerJoin\(\s*contractors/);
    expect(entryJoin).not.toMatch(/eq\(\s*contractors\.active/);
  });

  it("still requires an active contractor when creating assignments and time entries", () => {
    expect(functionBody(timesheetSource, "createAssignment")).toMatch(/eq\(\s*contractors\.active,\s*true\s*\)/);
    expect(functionBody(timesheetSource, "createTimeEntry")).toMatch(/eq\(\s*contractors\.active,\s*true\s*\)/);
    expect(timesheetSource).not.toMatch(/contractor_archived/);
  });
});
