import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mondayFor, shiftWeek, thisWeekSelection } from "../src/components/week-picker";

afterEach(() => {
  vi.useRealTimers();
});

describe("mondayFor", () => {
  it("maps a local Wednesday to the Monday of that week", () => {
    expect(mondayFor(new Date(2026, 8, 2))).toBe("2026-08-31");
  });

  it("keeps a local Monday on that Monday", () => {
    expect(mondayFor(new Date(2026, 7, 31))).toBe("2026-08-31");
  });

  it("keeps a local Sunday in the Monday week already in progress", () => {
    expect(mondayFor(new Date(2026, 8, 6))).toBe("2026-08-31");
  });
});

describe("thisWeekSelection", () => {
  it("returns the selected week string itself when today is already in that week", () => {
    const selectedWeek = "2026-08-31";
    const onMonday = thisWeekSelection(selectedWeek, new Date(2026, 7, 31));
    const onWednesday = thisWeekSelection(selectedWeek, new Date(2026, 8, 2));
    expect(onMonday).toBe("2026-08-31");
    expect(onWednesday).toBe("2026-08-31");
    expect(onMonday).toBe(selectedWeek);
    expect(onWednesday).toBe(selectedWeek);
  });

  it("jumps from a later week to the Monday week that contains today", () => {
    expect(thisWeekSelection("2026-09-07", new Date(2026, 8, 2))).toBe("2026-08-31");
  });

  it("uses mondayFor() for the local civil date when today is omitted", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 2));
    const selectedWeek = "2026-08-31";
    expect(thisWeekSelection("2026-09-07")).toBe("2026-08-31");
    expect(thisWeekSelection(selectedWeek)).toBe(selectedWeek);
  });
});

describe("shiftWeek", () => {
  it("moves the week start backward and forward by one week", () => {
    expect(shiftWeek("2026-09-07", -7)).toBe("2026-08-31");
    expect(shiftWeek("2026-09-07", 7)).toBe("2026-09-14");
  });
});

describe("WeekPicker", () => {
  it("shifts adjacent weeks and activates This week from the dashboard picker", () => {
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    const previous = dashboard.indexOf('aria-label="Previous week"');
    const thisWeek = dashboard.indexOf(">This week<");
    const weekOf = dashboard.indexOf("Week of");
    const next = dashboard.indexOf('aria-label="Next week"');
    expect(dashboard).toContain("shiftWeek(week, -7)");
    expect(dashboard).toContain("shiftWeek(week, 7)");
    expect(dashboard).toContain("thisWeekSelection(week)");
    expect(dashboard).toContain("useState(() => mondayFor())");
    expect(dashboard).toContain('mondayFor(new Date(`${e.target.value}T12:00:00`))');
    expect(previous).toBeGreaterThan(-1);
    expect(thisWeek).toBeGreaterThan(previous);
    expect(weekOf).toBeGreaterThan(thisWeek);
    expect(next).toBeGreaterThan(weekOf);
    const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");
    expect(css).toContain(".week-picker button { width:38px; height:38px;");
    expect(css).toContain(".week-picker button.this-week { width:auto; height:38px; padding:0 12px; font-size:.82rem; font-weight:700; line-height:38px; white-space:nowrap; flex:none; }");
    expect(css).toContain(".week-picker { width:100%; justify-content:space-between; }");
  });
});
