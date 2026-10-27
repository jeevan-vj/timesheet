import { describe, expect, it } from "vitest";
import { attendanceSuccessMessage, commitMarkedWorked, displayWeekTotals } from "../src/lib/week-attendance";
import { markWorkedRequests, type WeekGridEntry } from "../src/lib/week-grid";

function entry(id: string, occurrenceKind: WeekGridEntry["occurrenceKind"], paidMinutes: number): WeekGridEntry {
  return {
    id,
    contractorId: "c1",
    contractorName: "Pasindhu",
    siteId: "s1",
    siteName: "Whitford",
    workDate: "2026-08-31",
    paidMinutes,
    rateCents: 2_000,
    notes: "",
    entryMode: occurrenceKind === "absent" ? "absent" : "paid_hours",
    occurrenceKind,
    scheduleVersionId: "sv1",
  };
}

describe("mark all worked", () => {
  it("confirms every pending id, then resets them when undone before the request settles", async () => {
    const previous = [entry("mon", "scheduled", 90), entry("tue", "scheduled", 90), entry("wed", "absent", 0)];
    const calls: string[] = [];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const published: string[][] = [];
    let undo: (() => void) | undefined;
    const run = commitMarkedWorked({
      ids: ["mon", "tue"],
      previous,
      send: async (_url, body) => {
        const kind = (body as { kind: string }).kind;
        calls.push(kind);
        if (kind === "confirm_worked" && calls.length === 1) await gate;
      },
      reload: async () => { calls.push("reload"); },
      publish: (rows) => { published.push(rows.map((row) => `${row.id}:${row.occurrenceKind}:${row.paidMinutes}`)); },
      notify: (toast) => { undo = toast?.onUndo; },
      fail: () => { calls.push("fail"); },
      stillCurrent: () => true,
    });
    await Promise.resolve();
    expect(undo).toBeTypeOf("function");
    undo?.();
    release?.();
    await run;
    expect(markWorkedRequests(["mon", "tue"]).map((request) => request.body)).toEqual([
      { kind: "confirm_worked", scope: "this_day" },
      { kind: "confirm_worked", scope: "this_day" },
    ]);
    expect(published[0]).toEqual(["mon:worked:90", "tue:worked:90", "wed:absent:0"]);
    expect(calls.filter((call) => call === "confirm_worked")).toHaveLength(1);
    expect(calls.filter((call) => call === "worked_as_scheduled")).toHaveLength(2);
    expect(calls.at(-1)).toBe("reload");
    expect(published.at(-1)).toEqual(["mon:scheduled:90", "tue:scheduled:90", "wed:absent:0"]);
  });

  it("rolls the optimistic rows back when the first confirm is rejected", async () => {
    const previous = [entry("mon", "scheduled", 60)];
    const published: string[][] = [];
    const notices: string[] = [];
    await commitMarkedWorked({
      ids: ["mon"],
      previous,
      send: async () => { throw new Error("week_locked"); },
      reload: async () => { notices.push("reload"); },
      publish: (rows) => { published.push(rows.map((row) => row.occurrenceKind)); },
      notify: (toast) => { notices.push(toast?.message ?? "clear"); },
      fail: (error) => { notices.push(error instanceof Error ? error.message : "fail"); },
      stillCurrent: () => true,
    });
    expect(published[0]).toEqual(["worked"]);
    expect(published.at(-1)).toEqual(["scheduled"]);
    expect(notices).toContain("week_locked");
    expect(notices).toContain("clear");
    expect(notices).toContain("reload");
    expect(attendanceSuccessMessage(1)).toBe("Marked as worked.");
    expect(attendanceSuccessMessage(3)).toBe("Marked 3 days as worked.");
  });

  it("drops didn't-work minutes from the live payment summary", () => {
    const before = displayWeekTotals([entry("mon", "scheduled", 90), entry("tue", "scheduled", 90)]);
    const after = displayWeekTotals([
      { ...entry("mon", "absent", 0), entryMode: "absent" },
      entry("tue", "worked", 90),
    ]);
    expect(before.totalMinutes).toBe(180);
    expect(before.totalPay).toBe(6_000);
    expect(after.totalMinutes).toBe(90);
    expect(after.totalPay).toBe(3_000);
    expect(after.sites[0]).toMatchObject({ siteName: "Whitford", paidMinutes: 90, payCents: 3_000 });
  });
});
