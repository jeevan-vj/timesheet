import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  aucklandDateIso,
  formatDayHeading,
  formatUpdatedTime,
  formatWeekRange,
  offlineBannerText,
  portalCalendar,
  weekStartOrFallback,
} from "@cleantrack/core/portal";
import { isMonday } from "@cleantrack/core/payroll";
import { formatNzd } from "@cleantrack/core/week-rollup";

const OriginalDateTimeFormat = Intl.DateTimeFormat;
const OriginalNumberFormat = Intl.NumberFormat;

type FormatImpl = (date?: Date | number) => string;

function installDateTimeFormat(optionsFor: (options: Intl.DateTimeFormatOptions | undefined) => {
  format?: FormatImpl;
  formatToParts?: Intl.DateTimeFormat["formatToParts"] | undefined;
}) {
  let formatToPartsCalls = 0;
  function Patched(locales?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
    const formatter = new OriginalDateTimeFormat(locales, options);
    const behavior = optionsFor(options);
    return new Proxy(formatter, {
      get(target, prop, receiver) {
        if (prop === "format" && behavior.format) return behavior.format;
        if (prop === "formatToParts") {
          formatToPartsCalls += 1;
          if (behavior.formatToParts === undefined && Object.prototype.hasOwnProperty.call(behavior, "formatToParts")) {
            return undefined;
          }
          if (behavior.formatToParts) return behavior.formatToParts;
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
  Patched.prototype = OriginalDateTimeFormat.prototype;
  Patched.supportedLocalesOf = OriginalDateTimeFormat.supportedLocalesOf.bind(OriginalDateTimeFormat);
  Intl.DateTimeFormat = Patched as typeof Intl.DateTimeFormat;
  return {
    restore() {
      Intl.DateTimeFormat = OriginalDateTimeFormat;
    },
    formatToPartsCalls: () => formatToPartsCalls,
  };
}

function nzIso(instant: string): string {
  return new OriginalDateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(instant));
}

const boundaries = [
  "2026-09-26T13:59:59.000Z",
  "2026-09-26T14:00:00.000Z",
  "2026-10-25T10:30:00.000Z",
  "2026-10-25T11:00:00.000Z",
  "2026-10-26T10:59:59.000Z",
  "2026-10-26T11:00:00.000Z",
  "2026-10-26T23:30:00.000Z",
  "2026-10-27T00:30:00.000Z",
  "2026-07-15T11:59:59.000Z",
  "2026-07-15T12:00:00.000Z",
  "2026-04-04T13:59:59.000Z",
  "2026-04-04T14:00:00.000Z",
  "2026-12-31T10:59:59.000Z",
  "2026-12-31T11:00:00.000Z",
  "2025-09-27T13:59:59.000Z",
  "2025-09-27T14:00:00.000Z",
  "2025-04-05T13:59:59.000Z",
  "2025-04-05T14:00:00.000Z",
  "2024-09-28T13:59:59.000Z",
  "2024-09-28T14:00:00.000Z",
  "2027-04-03T13:59:59.000Z",
  "2027-04-03T14:00:00.000Z",
] as const;

afterEach(() => {
  Intl.DateTimeFormat = OriginalDateTimeFormat;
  Intl.NumberFormat = OriginalNumberFormat;
});

describe("aucklandDateIso", () => {
  it("does not read formatToParts", () => {
    expect(readFileSync("packages/core/src/portal.ts", "utf8")).not.toContain("formatToParts");
  });

  it("matches the Auckland civil date across DST and UTC midnight", () => {
    for (const instant of boundaries) {
      expect(aucklandDateIso(new Date(instant)), instant).toBe(nzIso(instant));
    }
    expect(nzIso("2026-10-26T10:59:59.000Z")).toBe("2026-10-26");
    expect(nzIso("2026-10-26T11:00:00.000Z")).toBe("2026-10-27");
    expect(nzIso("2026-10-26T23:30:00.000Z")).toBe("2026-10-27");
    expect(nzIso("2026-07-15T11:59:59.000Z")).toBe("2026-07-15");
    expect(nzIso("2026-07-15T12:00:00.000Z")).toBe("2026-07-16");
    expect(nzIso("2026-12-31T11:00:00.000Z")).toBe("2027-01-01");
  });

  it.each([
    ["throw", () => { throw new Error("formatToParts"); }],
    ["mislabeled", () => [{ type: "unknown" as const, value: "27" }]],
    ["undefined", undefined],
  ] as const)("keeps the Auckland date when formatToParts is %s", (_label, formatToParts) => {
    const installed = installDateTimeFormat(() => ({ formatToParts }));
    try {
      for (const instant of boundaries) {
        expect(aucklandDateIso(new Date(instant)), instant).toBe(nzIso(instant));
      }
      expect(installed.formatToPartsCalls()).toBe(0);
    } finally {
      installed.restore();
    }
  });

  it("uses the NZ offset when every DateTimeFormat format throws", () => {
    const installed = installDateTimeFormat(() => ({
      format: () => {
        throw new Error("format");
      },
      formatToParts: undefined,
    }));
    try {
      for (const instant of boundaries) {
        expect(aucklandDateIso(new Date(instant)), instant).toBe(nzIso(instant));
      }
      expect(aucklandDateIso(new Date(Number.NaN))).toBe("1970-01-01");
    } finally {
      installed.restore();
    }
  });

  it("keeps the Auckland date and clock when Intl ignores timeZone", () => {
    const installed = installDateTimeFormat((options) => ({
      format: (value) => {
        const date = value instanceof Date ? value : new Date(Number(value));
        const locale = options?.hour ? "en-NZ" : "en-CA";
        return new OriginalDateTimeFormat(locale, { ...options, timeZone: "America/Los_Angeles" }).format(date);
      },
    }));
    try {
      expect(aucklandDateIso(new Date("2026-10-26T11:00:00.000Z"))).toBe("2026-10-27");
      expect(aucklandDateIso(new Date("2026-07-15T12:00:00.000Z"))).toBe("2026-07-16");
      expect(formatUpdatedTime(Date.UTC(2026, 9, 27, 21, 42))).toBe("10:42 am");
      expect(formatUpdatedTime(Date.UTC(2026, 6, 15, 2, 0))).toBe("2:00 pm");
    } finally {
      installed.restore();
    }
  });
});

describe("portal calendar", () => {
  it("turns today into the Monday week and survives a bad clock", () => {
    expect(portalCalendar(new Date("2026-10-26T11:30:00.000Z"))).toEqual({
      today: "2026-10-27",
      weekStart: "2026-10-26",
    });
    expect(portalCalendar(new Date("2026-10-25T10:30:00.000Z"))).toEqual({
      today: "2026-10-25",
      weekStart: "2026-10-19",
    });
    expect(portalCalendar(new Date("2026-10-25T11:30:00.000Z"))).toEqual({
      today: "2026-10-26",
      weekStart: "2026-10-26",
    });
    expect(weekStartOrFallback("2026-10-27")).toBe("2026-10-26");
    expect(weekStartOrFallback("not-a-date")).toBe("1969-12-29");
    expect(isMonday(weekStartOrFallback("not-a-date"))).toBe(true);
    expect(portalCalendar(new Date(Number.NaN))).toEqual({
      today: "1970-01-01",
      weekStart: "1969-12-29",
    });
  });

  it("keeps Home, Pay, and My week off the throwing date call", () => {
    for (const file of [
      "apps/mobile/src/app/(contractor)/(tabs)/index.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/pay.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/week.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("portalCalendar(");
      expect(source, file).not.toContain("aucklandDateIso");
      expect(source, file).not.toContain("weekStartFromDate");
    }
  });
});

describe("device date and money labels", () => {
  it("formats headings, ranges, and clocks", () => {
    expect(formatDayHeading("2026-10-27")).toBe("Tue 27 Oct");
    expect(() => formatDayHeading("27/10/2026")).toThrow("invalid_request");
    expect(formatWeekRange("2026-10-26", "2026-11-01")).toBe("26 Oct – 1 Nov");
    expect(formatUpdatedTime(Date.UTC(2026, 9, 27, 21, 42))).toBe("10:42 am");
    expect(formatUpdatedTime(Date.UTC(2026, 6, 15, 2, 0))).toBe("2:00 pm");
    expect(formatUpdatedTime(Date.UTC(2026, 6, 15, 12, 0))).toBe("12:00 am");
    expect(formatUpdatedTime(Date.UTC(2026, 9, 27, 23, 0))).toBe("12:00 pm");
    expect(() => formatUpdatedTime(Number.NaN)).toThrow("invalid_request");
    expect(offlineBannerText(null)).toBe("Offline. Last updated time is not saved yet.");
    expect(offlineBannerText(Number.NaN)).toBe("Offline. Last updated time is not saved yet.");
    expect(formatNzd(123_456)).toBe("$1,234.56");
    expect(formatNzd(0)).toBe("$0.00");
  });

  it("keeps labels when DateTimeFormat and NumberFormat throw", () => {
    const dates = installDateTimeFormat(() => ({
      format: () => {
        throw new Error("format");
      },
    }));
    function PatchedNumberFormat() {
      throw new Error("NumberFormat");
    }
    PatchedNumberFormat.prototype = OriginalNumberFormat.prototype;
    PatchedNumberFormat.supportedLocalesOf = OriginalNumberFormat.supportedLocalesOf.bind(OriginalNumberFormat);
    Intl.NumberFormat = PatchedNumberFormat as typeof Intl.NumberFormat;
    try {
      expect(formatDayHeading("2026-10-27")).toBe("Tue 27 Oct");
      expect(formatWeekRange("2026-10-26", "2026-11-01")).toBe("26 Oct – 1 Nov");
      expect(formatUpdatedTime(Date.UTC(2026, 9, 27, 21, 42))).toBe("10:42 am");
      expect(formatUpdatedTime(Date.UTC(2026, 6, 15, 2, 0))).toBe("2:00 pm");
      expect(formatUpdatedTime(Date.UTC(2026, 6, 15, 12, 0))).toBe("12:00 am");
      expect(offlineBannerText(Date.UTC(2026, 9, 27, 21, 42))).toBe("Offline. Last updated 10:42 am.");
      expect(formatNzd(123_456)).toBe("$1,234.56");
      expect(formatNzd(0)).toBe("$0.00");
      expect(formatNzd(-100)).toBe("-$1.00");
      expect(aucklandDateIso(new Date("2026-10-26T11:00:00.000Z"))).toBe("2026-10-27");
    } finally {
      dates.restore();
      Intl.NumberFormat = OriginalNumberFormat;
    }
  });

  it("replaces a non-currency NumberFormat result", () => {
    function PatchedNumberFormat() {
      return {
        format() {
          return "1234.560000";
        },
      };
    }
    PatchedNumberFormat.prototype = OriginalNumberFormat.prototype;
    PatchedNumberFormat.supportedLocalesOf = OriginalNumberFormat.supportedLocalesOf.bind(OriginalNumberFormat);
    Intl.NumberFormat = PatchedNumberFormat as unknown as typeof Intl.NumberFormat;
    try {
      expect(formatNzd(123_456)).toBe("$1,234.56");
      expect(formatNzd(-100)).toBe("-$1.00");
    } finally {
      Intl.NumberFormat = OriginalNumberFormat;
    }
  });
});
