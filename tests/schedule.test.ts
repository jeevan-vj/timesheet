import { describe, expect, it } from "vitest";
import {
  WEEKDAY_FRI,
  WEEKDAY_MON,
  WEEKDAY_SAT,
  WEEKDAY_SUN,
  WEEKDAY_THU,
  WEEKDAY_TUE,
  WEEKDAY_WED,
  addDaysIso,
  dateIsoWeekday,
  decodeWeekdays,
  encodeWeekdays,
  expandScheduledDates,
  formatWeekdaysLabel,
  midWeekGoingForward,
  planCloseAndOpenVersions,
  scheduleSummaryText,
  shouldSkipExistingEntry,
} from "../src/lib/schedule";

const WEEK_START = "2026-08-31";
const WEEKDAYS_MON_FRI = encodeWeekdays([
  WEEKDAY_MON,
  WEEKDAY_TUE,
  WEEKDAY_WED,
  WEEKDAY_THU,
  WEEKDAY_FRI,
]);

describe("weekday mask encode/decode", () => {
  it("encodes ISO weekdays as bits 1 << (n - 1) and decodes unique sorted days", () => {
    expect(WEEKDAY_MON).toBe(1);
    expect(WEEKDAY_SUN).toBe(7);
    expect(encodeWeekdays([WEEKDAY_MON])).toBe(1);
    expect(encodeWeekdays([WEEKDAY_TUE])).toBe(2);
    expect(encodeWeekdays([WEEKDAY_SUN])).toBe(64);
    expect(WEEKDAYS_MON_FRI).toBe(31);
    expect(decodeWeekdays(31)).toEqual([1, 2, 3, 4, 5]);
    expect(decodeWeekdays(encodeWeekdays([WEEKDAY_FRI, WEEKDAY_MON, WEEKDAY_WED]))).toEqual([1, 3, 5]);
  });

  it("rejects empty or out-of-range weekday lists and masks", () => {
    expect(() => encodeWeekdays([])).toThrow("invalid_request");
    expect(() => encodeWeekdays([0])).toThrow("invalid_request");
    expect(() => encodeWeekdays([8])).toThrow("invalid_request");
    expect(() => encodeWeekdays([1, 1])).toThrow("invalid_request");
    expect(() => decodeWeekdays(0)).toThrow("invalid_request");
    expect(() => decodeWeekdays(128)).toThrow("invalid_request");
    expect(() => decodeWeekdays(1.5)).toThrow("invalid_request");
  });
});

describe("ISO date helpers", () => {
  it("returns ISO weekdays 1–7 using UTC midnight like payroll", () => {
    expect(dateIsoWeekday("2026-08-31")).toBe(WEEKDAY_MON);
    expect(dateIsoWeekday("2026-09-01")).toBe(WEEKDAY_TUE);
    expect(dateIsoWeekday("2026-09-06")).toBe(WEEKDAY_SUN);
    expect(() => dateIsoWeekday("31/08/2026")).toThrow("invalid_request");
  });

  it("adds whole days in UTC without timezone drift", () => {
    expect(addDaysIso("2026-08-31", 6)).toBe("2026-09-06");
    expect(addDaysIso("2026-09-07", -1)).toBe("2026-09-06");
    expect(() => addDaysIso("2026-13-01", 1)).toThrow("invalid_request");
  });
});

describe("expandScheduledDates", () => {
  it("includes remaining days only when effectiveFrom is mid-week", () => {
    expect(
      expandScheduledDates({
        weekStart: WEEK_START,
        weekdaysMask: WEEKDAYS_MON_FRI,
        paidMinutes: 90,
        effectiveFrom: "2026-09-02",
        effectiveTo: null,
      }),
    ).toEqual([
      { workDate: "2026-09-02", paidMinutes: 90 },
      { workDate: "2026-09-03", paidMinutes: 90 },
      { workDate: "2026-09-04", paidMinutes: 90 },
    ]);
  });

  it("stops at overlapping week effective_to inclusive", () => {
    expect(
      expandScheduledDates({
        weekStart: WEEK_START,
        weekdaysMask: WEEKDAYS_MON_FRI,
        paidMinutes: 60,
        effectiveFrom: WEEK_START,
        effectiveTo: "2026-09-02",
      }),
    ).toEqual([
      { workDate: "2026-08-31", paidMinutes: 60 },
      { workDate: "2026-09-01", paidMinutes: 60 },
      { workDate: "2026-09-02", paidMinutes: 60 },
    ]);
  });

  it("omits dates whose weekday bit is unset", () => {
    expect(
      expandScheduledDates({
        weekStart: WEEK_START,
        weekdaysMask: encodeWeekdays([WEEKDAY_MON, WEEKDAY_WED, WEEKDAY_FRI]),
        paidMinutes: 45,
        effectiveFrom: WEEK_START,
        effectiveTo: null,
      }).map((row) => row.workDate),
    ).toEqual(["2026-08-31", "2026-09-02", "2026-09-04"]);
  });

  it("rejects a non-Monday week start", () => {
    expect(() =>
      expandScheduledDates({
        weekStart: "2026-09-01",
        weekdaysMask: WEEKDAYS_MON_FRI,
        paidMinutes: 90,
        effectiveFrom: WEEK_START,
        effectiveTo: null,
      }),
    ).toThrow("invalid_week");
  });
});

describe("version close/open planning", () => {
  it("closes the current version on Sunday when the new version starts Monday", () => {
    expect(
      planCloseAndOpenVersions({
        currentEffectiveFrom: WEEK_START,
        newEffectiveFrom: "2026-09-07",
      }),
    ).toEqual({
      closeEffectiveTo: "2026-09-06",
      newEffectiveFrom: "2026-09-07",
    });
  });

  it("rejects a non-Monday new effective_from", () => {
    expect(() =>
      planCloseAndOpenVersions({
        currentEffectiveFrom: WEEK_START,
        newEffectiveFrom: "2026-09-02",
      }),
    ).toThrow("invalid_week");
  });
});

describe("mid-week going-forward", () => {
  it("starts the new version next Monday when the work date is Tuesday–Sunday", () => {
    expect(midWeekGoingForward("2026-09-01")).toEqual({
      thisDayOnly: true,
      newEffectiveFrom: "2026-09-07",
    });
    expect(midWeekGoingForward("2026-09-06")).toEqual({
      thisDayOnly: true,
      newEffectiveFrom: "2026-09-07",
    });
  });

  it("starts the new version on that Monday when the work date is Monday", () => {
    expect(midWeekGoingForward(WEEK_START)).toEqual({
      thisDayOnly: false,
      newEffectiveFrom: WEEK_START,
    });
  });
});

describe("weekday labels, skip-if-entry-exists, and summary text", () => {
  it("formats a contiguous range as Mon–Fri style and otherwise lists days", () => {
    expect(formatWeekdaysLabel([1, 2, 3, 4, 5])).toBe("Mon–Fri");
    expect(formatWeekdaysLabel([WEEKDAY_SAT, WEEKDAY_SUN])).toBe("Sat–Sun");
    expect(formatWeekdaysLabel([WEEKDAY_MON])).toBe("Mon");
    expect(formatWeekdaysLabel([WEEKDAY_MON, WEEKDAY_WED, WEEKDAY_FRI])).toBe("Mon, Wed, Fri");
  });

  it("skips apply when any time entry row already exists for that date", () => {
    expect(shouldSkipExistingEntry(null)).toBe(false);
    expect(shouldSkipExistingEntry({ id: "entry-1" })).toBe(true);
  });

  it("formats the assignment summary with rate and Mon–Fri · duration/day", () => {
    expect(
      scheduleSummaryText({
        contractorName: "Pasindhu",
        siteName: "Whitford",
        rateCents: 3_200,
        weekdays: [1, 2, 3, 4, 5],
        paidMinutes: 90,
      }),
    ).toBe("Pasindhu — Whitford\nNZ$32/hr · Mon–Fri · 1h 30m/day");
  });
});
