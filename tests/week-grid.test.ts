import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDaysIso } from "../src/lib/schedule";
import {
  initialScheduleDraft,
  scheduleChangeMonday,
  scheduleEditorMode,
  schedulePutPayload,
  toggleScheduleWeekday,
} from "../src/lib/schedule-editor";
import {
  absentScopeLabel,
  buildWeekGridRows,
  entryForCell,
  exceptionRequest,
  hoursOverrideScopeLabels,
  NOT_WORKED_LABEL,
  presentWeekGridCell,
  SCHEDULE_GOING_FORWARD_LABEL,
  THIS_DAY_ONLY_LABEL,
  THIS_OCCURRENCE_ONLY_LABEL,
  weekGridColumns,
  weekGridIsEmpty,
} from "../src/lib/week-grid";
import { applyScheduleBody, applyThenDashboardUrls, shouldApplySchedule } from "../src/lib/week-load";

const WEEK_START = "2026-08-31";

const contractors = [{ id: "c1", name: "Pasindhu" }, { id: "c2", name: "Aroha" }];
const sites = [{ id: "s1", name: "Whitford" }, { id: "s2", name: "Harbour Offices" }];
const scheduledAssignment = {
  id: "a1",
  contractorId: "c1",
  siteId: "s1",
  rateCents: 3_200,
  schedule: { id: "sv1", weekdays: [1, 2, 3, 4, 5], paidMinutes: 90, effectiveFrom: WEEK_START },
};

describe("week grid presenters", () => {
  it("presents empty, scheduled, absent, manual, and override cells", () => {
    expect(presentWeekGridCell(null)).toMatchObject({ kind: "empty", label: "", actions: [] });
    expect(presentWeekGridCell({ occurrenceKind: "scheduled", paidMinutes: 90 })).toMatchObject({
      kind: "scheduled",
      label: "1h 30m",
      actions: ["worked_as_scheduled", "absent", "change_hours"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 })).toMatchObject({
      kind: "absent",
      label: NOT_WORKED_LABEL,
      actions: ["worked_as_scheduled", "change_hours"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 }).actions).not.toContain("absent");
    expect(presentWeekGridCell({ occurrenceKind: "hours_override", paidMinutes: 120 })).toMatchObject({
      kind: "hours_override",
      label: "2h",
      actions: ["worked_as_scheduled", "absent", "change_hours"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "manual", paidMinutes: 480 })).toMatchObject({
      kind: "manual",
      label: "8h",
      actions: ["edit", "delete"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "scheduled", paidMinutes: 90 }).actions).not.toContain("delete");
    expect(presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 }).actions).not.toContain("delete");
    expect(presentWeekGridCell({ occurrenceKind: "hours_override", paidMinutes: 60 }).actions).not.toContain("delete");
  });

  it("keeps this day only vs schedule going forward, and absent as this occurrence only", () => {
    expect(hoursOverrideScopeLabels()).toEqual({
      thisDayOnly: THIS_DAY_ONLY_LABEL,
      goingForward: SCHEDULE_GOING_FORWARD_LABEL,
    });
    expect(THIS_DAY_ONLY_LABEL).toBe("this day only");
    expect(SCHEDULE_GOING_FORWARD_LABEL).toBe("schedule going forward");
    expect(absentScopeLabel()).toBe("this occurrence only");
    expect(THIS_OCCURRENCE_ONLY_LABEL).toBe("this occurrence only");
    expect(exceptionRequest("e1", { kind: "absent" }).body).toEqual({ kind: "absent", scope: "this_day" });
    expect(exceptionRequest("e1", { kind: "worked_as_scheduled" }).body).toEqual({
      kind: "worked_as_scheduled",
      scope: "this_day",
    });
    expect(exceptionRequest("e1", { kind: "hours_override", paidMinutes: 75, scope: "going_forward" }).body).toEqual({
      kind: "hours_override",
      paidMinutes: 75,
      scope: "going_forward",
    });
  });

  it("builds contractor+site rows from scheduled assignments and entry pairs", () => {
    const rows = buildWeekGridRows({
      assignments: [
        scheduledAssignment,
        { id: "a2", contractorId: "c2", siteId: "s2", rateCents: null, schedule: null },
      ],
      contractors,
      sites,
      entries: [{
        contractorId: "c2",
        contractorName: "Aroha",
        siteId: "s2",
        siteName: "Harbour Offices",
      }],
    });
    expect(rows.map((row) => `${row.contractorName}:${row.siteName}`)).toEqual([
      "Aroha:Harbour Offices",
      "Pasindhu:Whitford",
    ]);
    expect(weekGridIsEmpty(rows, [{}])).toBe(false);
    expect(weekGridIsEmpty([], [])).toBe(true);
    expect(weekGridColumns(WEEK_START).map((column) => column.weekdayLabel)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
    expect(weekGridColumns(WEEK_START)[0]?.iso).toBe(WEEK_START);
    const monday = { contractorId: "c1", siteId: "s1", workDate: WEEK_START, id: "e1" };
    expect(entryForCell([monday], "c1", "s1", WEEK_START)?.id).toBe("e1");
    expect(entryForCell([monday], "c1", "s1", addDaysIso(WEEK_START, 1))).toBeNull();
  });
});

describe("apply then GET", () => {
  it("skips apply when the week is already approved or no assignment has a schedule", () => {
    const scheduled = [{ schedule: { id: "sv1" } }];
    expect(shouldApplySchedule("approved", scheduled)).toBe(false);
    expect(shouldApplySchedule("open", [])).toBe(false);
    expect(shouldApplySchedule("open", [{ schedule: null }])).toBe(false);
    expect(shouldApplySchedule("open", scheduled)).toBe(true);
    expect(shouldApplySchedule("reopened", scheduled)).toBe(true);
    expect(shouldApplySchedule(undefined, scheduled)).toBe(true);
    expect(applyThenDashboardUrls(WEEK_START)).toEqual({
      dashboard: `/api/dashboard?week=${WEEK_START}`,
      apply: "/api/weeks/apply-schedule",
    });
    expect(applyScheduleBody(WEEK_START)).toEqual({ weekStart: WEEK_START });
  });

  it("posts apply-schedule before the second GET when the week is not approved", () => {
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    expect(dashboard).toContain("/api/weeks/apply-schedule");
    expect(dashboard).toContain("shouldApplySchedule");
    expect(dashboard).toContain("applyThenDashboardUrls");
    expect(dashboard).toMatch(/shouldApplySchedule\(next\.approval\.status, next\.assignments\)/);
    expect(dashboard).toMatch(/send\("\/api\/weeks\/apply-schedule"/);
    const loadStart = dashboard.indexOf("const load = useCallback");
    const load = dashboard.slice(loadStart, dashboard.indexOf("useEffect(() => { void load(); }"));
    expect(load).toMatch(/fetch\(urls\.dashboard[\s\S]*shouldApplySchedule[\s\S]*apply-schedule[\s\S]*fetch\(urls\.dashboard/);
    expect(dashboard).not.toContain("owner_user_id");
  });
});

describe("schedule editor going-forward Monday", () => {
  it("uses the visible Monday, or next Monday when the week is approved", () => {
    expect(scheduleChangeMonday(WEEK_START, false)).toBe(WEEK_START);
    expect(scheduleChangeMonday(WEEK_START, true)).toBe("2026-09-07");
    expect(scheduleEditorMode(false)).toBe("create");
    expect(scheduleEditorMode(true)).toBe("going_forward");
    const created = schedulePutPayload({
      draft: initialScheduleDraft(null),
      weekStart: WEEK_START,
      weekLocked: false,
      hasCurrentSchedule: false,
    });
    expect(created.body).toMatchObject({
      mode: "create",
      fromDate: WEEK_START,
      weekStart: WEEK_START,
      paidMinutes: 90,
    });
    const forward = schedulePutPayload({
      draft: { weekdays: toggleScheduleWeekday([1, 2, 3, 4, 5], 6), paidHours: 2, paidMinutePart: 0 },
      weekStart: WEEK_START,
      weekLocked: true,
      hasCurrentSchedule: true,
    });
    expect(forward.body).toMatchObject({
      mode: "going_forward",
      weekStart: "2026-09-07",
      paidMinutes: 120,
    });
    expect(forward.body).not.toHaveProperty("fromDate");
  });
});

describe("week grid source contract", () => {
  it("renders a Mon–Sun grid with Not worked text and locked cell actions", () => {
    const grid = fs.readFileSync(path.resolve("src/components/week-grid.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    expect(grid).toContain("Mon");
    expect(grid).toContain("Not worked");
    expect(grid).toContain("this day only");
    expect(grid).toContain("this occurrence only");
    expect(grid).toContain("schedule going forward");
    expect(grid).toContain("disabled={locked}");
    expect(grid).not.toContain("Approve week");
    expect(grid).not.toContain("Reopen week");
    expect(grid).not.toContain("owner_user_id");
    expect(dashboard).toContain("<WeekGrid");
    expect(dashboard).toContain("<AddRepeatingSchedule");
    expect(grid).toContain("Add repeating schedule");
    expect(dashboard).not.toMatch(/copy previous week/i);
    expect(grid).not.toMatch(/copy previous week/i);
  });
});
