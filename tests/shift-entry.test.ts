import { describe, expect, it, vi } from "vitest";
import { calculateEntryPayCents } from "../src/lib/payroll";
import {
  ASSIGN_ANOTHER_SITE,
  clockShiftError,
  createShiftSaveGuard,
  effectiveRateCents,
  formatPayPreview,
  initialShiftDraft,
  paidHoursError,
  parseRateDollars,
  selectContractor,
  shiftEntryBlocker,
  shiftEntryPayload,
  shiftSaveErrorMessage,
  sitesForContractor,
  switchEntryMode,
} from "../src/lib/shift-entry";

const sites = [
  { id: "s1", name: "Harbour Offices" },
  { id: "s2", name: "Warehouse" },
  { id: "s3", name: "Clinic" },
];
const assignments = [
  { contractorId: "c1", siteId: "s1", rateCents: 3_200 },
  { contractorId: "c1", siteId: "s2", rateCents: null },
  { contractorId: "c2", siteId: "s3", rateCents: 2_800 },
];

describe("shift entry draft", () => {
  it("defaults to paid hours without inventing a missing site", () => {
    const draft = initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" });
    expect(draft.mode).toBe("paid_hours");
    expect(draft.workDate).toBe("2026-08-31");
    expect(draft.paidHours).toBe(8);
    expect(draft.paidMinutePart).toBe(0);
    expect(draft.assigningSite).toBe(false);
  });

  it("opens in assign-site mode when the contractor has no assigned site", () => {
    const draft = initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c2", siteId: "" });
    expect(draft.assigningSite).toBe(true);
  });

  it("keeps contractor, site, date, and notes when switching entry method", () => {
    const draft = switchEntryMode({
      ...initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }),
      notes: "Keys returned",
      paidHours: 6,
      start: "09:00",
    }, "clock");

    expect(draft.mode).toBe("clock");
    expect(draft.contractorId).toBe("c1");
    expect(draft.siteId).toBe("s1");
    expect(draft.workDate).toBe("2026-08-31");
    expect(draft.notes).toBe("Keys returned");
    expect(draft.paidHours).toBe(6);
    expect(draft.start).toBe("09:00");
  });

  it("clears a site that is not assigned to the newly selected contractor", () => {
    const next = selectContractor(
      initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }),
      "c2",
      assignments.filter((row) => row.contractorId === "c2").map((row) => row.siteId),
    );
    expect(next.contractorId).toBe("c2");
    expect(next.siteId).toBe("");
    expect(next.assigningSite).toBe(false);
    expect(next.newSiteId).toBe("");
  });

  it("opens assign-site when the new contractor has no assigned sites", () => {
    const next = selectContractor(
      initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }),
      "c3",
      [],
    );
    expect(next.siteId).toBe("");
    expect(next.assigningSite).toBe(true);
  });

  it("keeps a site that remains assigned after a contractor change", () => {
    const next = selectContractor(
      { ...initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }), notes: "keep" },
      "c1",
      ["s1", "s2"],
    );
    expect(next.siteId).toBe("s1");
    expect(next.assigningSite).toBe(false);
    expect(next.notes).toBe("keep");
  });
});

describe("site choices", () => {
  it("lists assigned sites first and other active sites for inline assignment", () => {
    const grouped = sitesForContractor(sites, assignments, "c1");
    expect(grouped.assigned.map((site) => site.id)).toEqual(["s1", "s2"]);
    expect(grouped.unassigned.map((site) => site.id)).toEqual(["s3"]);
  });

  it("uses the assignment override when present, otherwise the contractor default", () => {
    expect(effectiveRateCents({ defaultRateCents: 3_000, assignmentRateCents: 3_200, overrideRateCents: null })).toBe(3_200);
    expect(effectiveRateCents({ defaultRateCents: 3_000, assignmentRateCents: null, overrideRateCents: null })).toBe(3_000);
    expect(effectiveRateCents({ defaultRateCents: 3_000, assignmentRateCents: null, overrideRateCents: 3_500 })).toBe(3_500);
  });
});

describe("duration and pay preview", () => {
  it("formats the live preview from integer minutes and cents", () => {
    expect(formatPayPreview(480, 3_000)).toBe("8h × NZ$30/hr = NZ$240");
    expect(formatPayPreview(510, 3_000)).toBe("8h 30m × NZ$30/hr = NZ$255");
    expect(formatPayPreview(95, 2_750)).toBe(`1h 35m × NZ$27.50/hr = NZ$${calculateEntryPayCents(95, 2_750) / 100}`);
  });

  it("explains invalid start/finish combinations", () => {
    expect(clockShiftError(16 * 60, 8 * 60, 0)).toBe("Finish must be later than start on the same day.");
    expect(clockShiftError(8 * 60, 9 * 60, 60)).toBe("Unpaid break must leave a positive paid duration.");
    expect(clockShiftError(8 * 60, 16 * 60 + 30, 30)).toBeNull();
  });

  it("accepts hours plus minutes and rejects empty or overnight paid hours", () => {
    expect(paidHoursError(8, 0)).toBeNull();
    expect(paidHoursError(0, 15)).toBeNull();
    expect(paidHoursError(0, 0)).toBe("Paid hours must be greater than zero.");
    expect(paidHoursError(24, 0)).toBe("Paid hours must be less than 24 hours on the same day.");
    expect(paidHoursError(8, 60)).toBe("Minutes must be between 0 and 59.");
  });

  it("parses an optional site rate in integer cents", () => {
    expect(parseRateDollars("")).toBeNull();
    expect(parseRateDollars("32.5")).toBe(3_250);
    expect(parseRateDollars("10")).toBe("invalid");
  });
});

describe("save payload and errors", () => {
  it("sends paid minutes without clock fields", () => {
    const payload = shiftEntryPayload(initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }));
    expect(payload).toEqual({
      entryMode: "paid_hours",
      contractorId: "c1",
      siteId: "s1",
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "",
    });
  });

  it("sends start, finish, and break for clock mode", () => {
    const payload = shiftEntryPayload(switchEntryMode(
      initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: "s1" }),
      "clock",
    ));
    expect(payload).toMatchObject({
      entryMode: "clock",
      startMinutes: 8 * 60,
      endMinutes: 16 * 60 + 30,
      breakMinutes: 30,
    });
    expect(payload).not.toHaveProperty("paidMinutes");
  });

  it("includes an inline assignment for an unassigned site", () => {
    const payload = shiftEntryPayload({
      ...initialShiftDraft({ weekStart: "2026-08-31", contractorId: "c1", siteId: ASSIGN_ANOTHER_SITE }),
      assigningSite: true,
      newSiteId: "s3",
      newSiteRate: "35",
    });
    expect(payload.siteId).toBe("s3");
    expect(payload).toMatchObject({ assignSite: { rateCents: 3_500 } });
  });

  it("turns duplicate and missing-assignment failures into actionable copy", () => {
    expect(shiftSaveErrorMessage(new Error("duplicate_entry"))).toContain("already recorded");
    expect(shiftSaveErrorMessage(new Error("not_found"))).toContain("Assign the site");
    expect(shiftSaveErrorMessage(new Error("invalid_shift"))).toContain("positive paid");
  });

  it("points the owner to setup when contractors or sites are missing", () => {
    expect(shiftEntryBlocker({ contractors: [], sites: [{ id: "s1" }] })).toEqual({
      href: "#team",
      label: "Add a contractor",
      message: "Add a contractor before recording a shift.",
    });
    expect(shiftEntryBlocker({ contractors: [{ id: "c1" }], sites: [] })).toEqual({
      href: "#team",
      label: "Add a site",
      message: "Add a site before recording a shift.",
    });
    expect(shiftEntryBlocker({ contractors: [{ id: "c1" }], sites: [{ id: "s1" }] })).toBeNull();
  });

  it("ignores a second save while the first request is in flight", async () => {
    let finish!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const guard = createShiftSaveGuard();

    const first = guard.run(save);
    const second = guard.run(save);
    expect(guard.busy).toBe(true);
    finish();
    await Promise.all([first, second]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(guard.busy).toBe(false);
  });
});
