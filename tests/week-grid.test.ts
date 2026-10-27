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
  cellAriaLabel,
  entryForCell,
  exceptionRequest,
  hoursOverrideScopeLabels,
  NOT_WORKED_LABEL,
  menuKeyAction,
  nextMenuIndex,
  pendingEntryIds,
  placeWeekGridMenu,
  presentWeekGridCell,
  projectEntries,
  SCHEDULE_GOING_FORWARD_LABEL,
  THIS_DAY_ONLY_LABEL,
  THIS_OCCURRENCE_ONLY_LABEL,
  weekGridColumns,
  weekGridIsEmpty,
  type WeekGridEntry,
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
  it("presents empty, pending, worked, absent, manual, and changed-hour cells", () => {
    expect(presentWeekGridCell(null)).toMatchObject({ kind: "empty", label: "", menu: [], tapToMarkWorked: false });
    expect(presentWeekGridCell({ occurrenceKind: "scheduled", paidMinutes: 90 })).toMatchObject({
      kind: "scheduled",
      label: "1h 30m",
      statusLabel: "Pending",
      icon: "pending",
      tapToMarkWorked: true,
      menu: ["absent", "change_hours", "reset"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "worked", paidMinutes: 90 })).toMatchObject({
      kind: "worked",
      label: "1h 30m",
      statusLabel: "Worked",
      icon: "check",
      ariaLabel: "Worked as scheduled, 1h 30m",
      tapToMarkWorked: false,
    });
    expect(presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 }, 90)).toMatchObject({
      kind: "absent",
      label: "1h 30m",
      statusLabel: NOT_WORKED_LABEL,
      icon: "absent",
      strike: true,
      tapToMarkWorked: false,
    });
    expect(presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 }, 90).menu).not.toContain("delete");
    expect(presentWeekGridCell({ occurrenceKind: "hours_override", paidMinutes: 75 }, 60)).toMatchObject({
      kind: "hours_override",
      label: "1h 15m (sched 1h)",
      statusLabel: "Changed",
      icon: "changed",
      ariaLabel: "Changed hours, 1h 15m, scheduled 1h",
    });
    expect(presentWeekGridCell({ occurrenceKind: "manual", paidMinutes: 480 })).toMatchObject({
      kind: "manual",
      label: "8h",
      statusLabel: "Added",
      menu: ["edit", "delete"],
    });
    expect(presentWeekGridCell({ occurrenceKind: "scheduled", paidMinutes: 90 }).menu).not.toContain("delete");
    expect(presentWeekGridCell({ occurrenceKind: "worked", paidMinutes: 90 }).menu).not.toContain("delete");
    expect(presentWeekGridCell({ occurrenceKind: "hours_override", paidMinutes: 60 }, 60).menu).not.toContain("delete");
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
  it("renders a Mon–Sun grid with a legend and omits cell actions when locked", () => {
    const grid = fs.readFileSync(path.resolve("src/components/week-grid.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    const presenter = fs.readFileSync(path.resolve("src/lib/week-grid.ts"), "utf8");
    const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");
    expect(grid).toContain("Mon");
    expect(grid).toContain("WeekGridLegend");
    expect(grid).toContain("Mark all worked");
    expect(presenter).toContain("read-only");
    expect(grid).toContain("if (locked || menu.length === 0) return null");
    expect(grid).toContain("createPortal");
    expect(grid).toContain("placeWeekGridMenu");
    expect(css).toContain(".day-menu { position:fixed;");
    expect(grid).toContain("if (locked || ids.length === 0) return null");
    expect(presenter).toContain("Didn't work");
    expect(grid).toContain("this day only");
    expect(grid).toContain("this occurrence only");
    expect(grid).toContain("schedule going forward");
    expect(grid).not.toContain("Approve week");
    expect(grid).not.toContain("Reopen week");
    expect(grid).not.toContain("owner_user_id");
    expect(grid).not.toContain(">Worked as scheduled<");
    expect(dashboard).toContain("<WeekGrid");
    expect(dashboard).toContain("<AddRepeatingSchedule");
    expect(dashboard).toContain("displayWeekTotals");
    expect(grid).toContain("Add repeating schedule");
    expect(dashboard).not.toMatch(/copy previous week/i);
    expect(grid).not.toMatch(/copy previous week/i);
  });
});

function gridEntry(partial: Partial<WeekGridEntry> & Pick<WeekGridEntry, "id" | "workDate" | "occurrenceKind" | "paidMinutes">): WeekGridEntry {
  return {
    contractorId: "c1",
    contractorName: "Pasindhu",
    siteId: "s1",
    siteName: "Whitford",
    rateCents: 3_200,
    notes: "",
    entryMode: partial.occurrenceKind === "absent" ? "absent" : "paid_hours",
    scheduleVersionId: "sv1",
    ...partial,
  };
}

describe("week grid bulk pending days", () => {
  const dates = weekGridColumns(WEEK_START).map((column) => column.iso);
  const entries = [
    gridEntry({ id: "mon", workDate: dates[0]!, occurrenceKind: "scheduled", paidMinutes: 60 }),
    gridEntry({ id: "tue", workDate: dates[1]!, occurrenceKind: "worked", paidMinutes: 60 }),
    gridEntry({ id: "wed", workDate: dates[2]!, occurrenceKind: "hours_override", paidMinutes: 75 }),
    gridEntry({ id: "thu", workDate: dates[3]!, occurrenceKind: "absent", paidMinutes: 0 }),
    gridEntry({ id: "other", workDate: dates[0]!, contractorId: "c2", siteId: "s2", occurrenceKind: "scheduled", paidMinutes: 60 }),
  ];

  it("marks only the remaining pending days in that contractor and site row", () => {
    const ids = pendingEntryIds(entries, "c1", "s1", dates);
    expect(ids).toEqual(["mon"]);
    const next = projectEntries(entries, ids, { kind: "confirm_worked" });
    expect(next.find((row) => row.id === "mon")).toMatchObject({ occurrenceKind: "worked", paidMinutes: 60, rateCents: 3_200 });
    expect(next.find((row) => row.id === "tue")?.occurrenceKind).toBe("worked");
    expect(next.find((row) => row.id === "wed")).toMatchObject({ occurrenceKind: "hours_override", paidMinutes: 75 });
    expect(next.find((row) => row.id === "thu")).toMatchObject({ occurrenceKind: "absent", paidMinutes: 0 });
    expect(next.find((row) => row.id === "other")?.occurrenceKind).toBe("scheduled");
    expect(pendingEntryIds(next, "c1", "s1", dates)).toEqual([]);
  });
});

describe("week grid accessible names", () => {
  it("names the state in text and appends read-only when the week is locked", () => {
    const pending = presentWeekGridCell({ occurrenceKind: "scheduled", paidMinutes: 60 });
    const changed = presentWeekGridCell({ occurrenceKind: "hours_override", paidMinutes: 75 }, 60);
    const absent = presentWeekGridCell({ occurrenceKind: "absent", paidMinutes: 0 }, 60);
    const place = { contractorName: "Pasindhu", siteName: "Whitford", dayLabel: "Mon 31 Aug" };
    expect(cellAriaLabel(pending, place, false)).toBe("Pending, 1h scheduled, Pasindhu at Whitford, Mon 31 Aug. Mark worked");
    expect(cellAriaLabel(changed, place, false)).toBe("Changed hours, 1h 15m, scheduled 1h, Pasindhu at Whitford, Mon 31 Aug");
    expect(cellAriaLabel(absent, place, true)).toBe("Didn't work, 1h scheduled, Pasindhu at Whitford, Mon 31 Aug, read-only");
    expect(pending.tapToMarkWorked).toBe(true);
    expect(changed.tapToMarkWorked).toBe(false);
    expect(absent.tapToMarkWorked).toBe(false);
  });
});

function contrast(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    const channel = (part: number) => {
      const scaled = part / 255;
      return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    const red = channel((value >> 16) & 255);
    const green = channel((value >> 8) & 255);
    const blue = channel(value & 255);
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const left = luminance(foreground);
  const right = luminance(background);
  const [hi, lo] = left > right ? [left, right] : [right, left];
  return (hi + 0.05) / (lo + 0.05);
}

describe("week grid menu placement", () => {
  const menu = { width: 184, height: 148 };
  const viewport = { width: 1440, height: 900 };

  it("opens below the trigger and aligns to its right edge", () => {
    expect(placeWeekGridMenu({ top: 100, left: 400, width: 48, height: 44 }, menu, viewport)).toEqual({
      top: 148,
      left: 264,
      placement: "below",
    });
  });

  it("flips above the trigger when the row is near the bottom", () => {
    expect(placeWeekGridMenu({ top: 780, left: 400, width: 48, height: 44 }, menu, { width: 1440, height: 860 })).toEqual({
      top: 628,
      left: 264,
      placement: "above",
    });
  });

  it("flips sideways when aligning to the right edge would leave the viewport", () => {
    expect(placeWeekGridMenu({ top: 100, left: 12, width: 44, height: 44 }, menu, viewport)).toMatchObject({
      left: 12,
      placement: "below",
    });
  });

  it("shifts a wide menu sideways so it stays inside the viewport", () => {
    expect(placeWeekGridMenu({ top: 40, left: 100, width: 40, height: 44 }, { width: 250, height: 80 }, { width: 300, height: 400 })).toMatchObject({
      top: 88,
      left: 46,
      placement: "below",
    });
  });

  it("moves between items with arrow keys and closes on escape", () => {
    expect(nextMenuIndex(-1, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(-1, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(2, 3, "ArrowDown")).toBe(0);
    expect(nextMenuIndex(0, 3, "ArrowUp")).toBe(2);
    expect(nextMenuIndex(1, 3, "Home")).toBeNull();
    expect(menuKeyAction({ key: "Escape", activeIndex: 1, length: 3, focusInMenu: true })).toBe("close");
    expect(menuKeyAction({ key: "ArrowDown", activeIndex: 0, length: 3, focusInMenu: false })).toBeNull();
    expect(menuKeyAction({ key: "ArrowDown", activeIndex: -1, length: 3, focusInMenu: true })).toBe(0);
  });
});

describe("week grid state contrast", () => {
  it("keeps text and state boundaries at WCAG AA", () => {
    const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");
    expect(css).toContain("--green:#164b36");
    expect(css).toContain("border-color:#5c675f");
    expect(css).toContain(".week-grid-cell.is-changed .day-chip-main { background:#f6d98a; border-color:#8a5610; color:#17211c; }");
    expect(css).toContain(".week-grid-cell.is-absent .day-chip-main { background:#efe2e0; border-color:#8c3d36; color:#7a2e28; }");
    expect(contrast("#17211c", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#ffffff", "#164b36")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#17211c", "#f6d98a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#6b420c", "#f6d98a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#7a2e28", "#efe2e0")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#8a5610", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast("#8c3d36", "#ffffff")).toBeGreaterThanOrEqual(3);
    expect(contrast("#5c675f", "#ffffff")).toBeGreaterThanOrEqual(3);
  });
});
