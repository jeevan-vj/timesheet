import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { calculateEntryPayCents } from "../src/lib/payroll";
import {
  ASSIGN_ANOTHER_SITE,
  breakMinuteOptions,
  clockShiftError,
  contractorsForEdit,
  createShiftSaveGuard,
  draftFromTimeEntry,
  draftSaveError,
  editPreviewRateCents,
  effectiveRateCents,
  formatPayPreview,
  fromMinutes,
  initialShiftDraft,
  paidHoursError,
  shiftDateBounds,
  parseRateDollars,
  selectContractor,
  shiftEntryBlocker,
  shiftEntryPayload,
  shiftSaveErrorMessage,
  shiftUpdatePayload,
  sitesForContractor,
  sitesForEdit,
  switchEntryMode,
  toMinutes,
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

const recordedPaidHours = {
  id: "e1",
  contractorId: "c1",
  contractorName: "Aroha",
  siteId: "s1",
  siteName: "Harbour Offices",
  workDate: "2026-08-31",
  startMinutes: 0,
  endMinutes: 480,
  breakMinutes: 0,
  paidMinutes: 480,
  rateCents: 2_500,
  notes: "Keys returned",
  entryMode: "paid_hours" as const,
};

const recordedClock = {
  ...recordedPaidHours,
  id: "e2",
  startMinutes: 8 * 60,
  endMinutes: 16 * 60 + 30,
  breakMinutes: 30,
  paidMinutes: 480,
  entryMode: "clock" as const,
};

describe("edit hydration", () => {
  it("splits paid_hours minutes and ignores clock sentinels", () => {
    const draft = draftFromTimeEntry(recordedPaidHours);
    expect(draft.mode).toBe("paid_hours");
    expect(draft.paidHours).toBe(8);
    expect(draft.paidMinutePart).toBe(0);
    expect(draft.start).toBe("08:00");
    expect(draft.end).toBe("16:30");
    expect(draft.start).not.toBe(fromMinutes(recordedPaidHours.startMinutes));
    expect(draft.contractorId).toBe("c1");
    expect(draft.siteId).toBe("s1");
    expect(draft.workDate).toBe("2026-08-31");
    expect(draft.notes).toBe("Keys returned");
    expect(draft.assigningSite).toBe(false);
  });

  it("splits a non-hour paid_hours duration into hours and minutes", () => {
    const draft = draftFromTimeEntry({ ...recordedPaidHours, paidMinutes: 95, endMinutes: 95 });
    expect(draft.mode).toBe("paid_hours");
    expect(draft.paidHours).toBe(1);
    expect(draft.paidMinutePart).toBe(35);
    expect(draft.start).toBe("08:00");
    expect(draft.end).toBe("16:30");
  });

  it("hydrates clock start, finish, and break as HH:MM", () => {
    const draft = draftFromTimeEntry(recordedClock);
    expect(draft.mode).toBe("clock");
    expect(draft.start).toBe("08:00");
    expect(draft.end).toBe("16:30");
    expect(draft.breakMinutes).toBe(30);
  });

  it("keeps a custom unpaid break instead of coercing it", () => {
    const draft = draftFromTimeEntry({ ...recordedClock, breakMinutes: 20 });
    expect(draft.breakMinutes).toBe(20);
    expect(breakMinuteOptions(20)).toEqual([0, 15, 30, 45, 60, 20]);
    expect(breakMinuteOptions(30)).toEqual([0, 15, 30, 45, 60]);
  });
});

describe("edit date bounds", () => {
  it("leaves create dates inside the displayed week and allows edit dates outside it", () => {
    expect(shiftDateBounds(false, "2026-08-31", "2026-09-06")).toEqual({ min: "2026-08-31", max: "2026-09-06" });
    expect(shiftDateBounds(true, "2026-08-31", "2026-09-06")).toEqual({ min: undefined, max: undefined });
  });
});

describe("clock minutes round-trip", () => {
  it("pads HH:MM as the inverse of toMinutes", () => {
    expect(fromMinutes(toMinutes("08:00"))).toBe("08:00");
    expect(fromMinutes(toMinutes("16:30"))).toBe("16:30");
    expect(fromMinutes(5)).toBe("00:05");
    expect(fromMinutes(0)).toBe("00:00");
    expect(toMinutes(fromMinutes(495))).toBe(495);
  });
});

describe("edit pay preview rate", () => {
  it("keeps the snapshotted entry rate when contractor and site are unchanged", () => {
    const draft = draftFromTimeEntry(recordedPaidHours);
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft,
      defaultRateCents: 3_000,
      assignmentRateCents: 3_200,
    })).toBe(2_500);
  });

  it("resnapshots from the current assignment or contractor default after a reclassification", () => {
    const draft = { ...draftFromTimeEntry(recordedPaidHours), siteId: "s2" };
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft,
      defaultRateCents: 3_000,
      assignmentRateCents: 3_200,
    })).toBe(3_200);
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft,
      defaultRateCents: 3_000,
      assignmentRateCents: null,
    })).toBe(3_000);
  });

  it("leaves the preview empty when a rate cannot be computed", () => {
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft: { ...draftFromTimeEntry(recordedPaidHours), siteId: "" },
      defaultRateCents: 3_000,
      assignmentRateCents: null,
    })).toBeNull();
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft: { ...draftFromTimeEntry(recordedPaidHours), contractorId: "c2", siteId: "s3" },
      defaultRateCents: null,
      assignmentRateCents: 2_800,
    })).toBe(2_800);
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft: { ...draftFromTimeEntry(recordedPaidHours), contractorId: "c2", siteId: "s3" },
      defaultRateCents: null,
      assignmentRateCents: null,
    })).toBeNull();
    expect(editPreviewRateCents({
      entry: recordedPaidHours,
      draft: { ...draftFromTimeEntry(recordedPaidHours), siteId: "s2" },
      defaultRateCents: 3_000,
      assignmentRateCents: undefined,
    })).toBeNull();
  });
});

describe("edit save payload and errors", () => {
  it("matches the create payload without assignSite", () => {
    const paidDraft = draftFromTimeEntry(recordedPaidHours);
    const clockDraft = draftFromTimeEntry(recordedClock);
    expect(shiftUpdatePayload(paidDraft)).toEqual({
      entryMode: "paid_hours",
      contractorId: "c1",
      siteId: "s1",
      workDate: "2026-08-31",
      paidMinutes: 480,
      notes: "Keys returned",
    });
    expect(shiftUpdatePayload(clockDraft)).toEqual({
      entryMode: "clock",
      contractorId: "c1",
      siteId: "s1",
      workDate: "2026-08-31",
      startMinutes: 8 * 60,
      endMinutes: 16 * 60 + 30,
      breakMinutes: 30,
      notes: "Keys returned",
    });
    const ignoredAssign = shiftUpdatePayload({
      ...paidDraft,
      assigningSite: true,
      newSiteId: "s3",
      newSiteRate: "35",
    });
    expect(ignoredAssign).not.toHaveProperty("assignSite");
    expect(ignoredAssign.siteId).toBe("s1");
  });

  it("uses edit-specific not_found copy that does not mention assigning a site", () => {
    expect(shiftSaveErrorMessage(new Error("not_found"))).toContain("Assign the site");
    expect(shiftSaveErrorMessage(new Error("not_found"), "edit")).toBe("That contractor is not assigned to this site.");
    expect(shiftSaveErrorMessage(new Error("not_found"), "edit")).not.toContain("Assign the site");
    expect(shiftSaveErrorMessage(new Error("not_found"), "edit")).not.toContain("from this form");
    expect(shiftSaveErrorMessage(new Error("duplicate_entry"), "edit")).toContain("already recorded");
  });

  it("does not require a new site when validating an edit draft", () => {
    const emptySite = { ...draftFromTimeEntry(recordedPaidHours), siteId: "", assigningSite: true, newSiteId: "" };
    expect(draftSaveError(emptySite)).toBe("Choose a site to assign.");
    expect(draftSaveError(emptySite, { allowAssignSite: false })).toBe("Choose a site.");
  });
});

describe("edit option lists", () => {
  it("keeps the persisted site when the assignment is no longer active", () => {
    const options = sitesForEdit(sites, assignments, "c1", {
      contractorId: "c1",
      siteId: "s3",
      siteName: "Clinic",
    });
    expect(options.map((site) => site.id)).toEqual(["s1", "s2", "s3"]);
    expect(sitesForEdit(sites, assignments, "c1", {
      contractorId: "c2",
      siteId: "s3",
      siteName: "Clinic",
    }).map((site) => site.id)).toEqual(["s1", "s2"]);
  });

  it("keeps a persisted contractor missing from the active list", () => {
    const contractors = [{ id: "c2", name: "Moana", defaultRateCents: 2_800 }];
    expect(contractorsForEdit(contractors, { id: "c1", name: "Aroha" }).map((row) => row.id)).toEqual(["c2", "c1"]);
    expect(contractorsForEdit(contractors, { id: "c2", name: "Moana" }).map((row) => row.id)).toEqual(["c2"]);
  });
});

describe("edit sheet wiring", () => {
  it("opens edit from the weekly row, PATCHes without assignSite, and leaves create/delete in place", () => {
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    const sheet = fs.readFileSync(path.resolve("src/components/shift-entry.tsx"), "utf8");

    expect(dashboard).toContain("Edit ${entry.contractorName} shift");
    expect(dashboard).toContain("Delete ${entry.contractorName} shift");
    expect(dashboard).toContain("send(\"/api/time-entries\", body)");
    expect(dashboard).toMatch(/send\(`\/api\/time-entries\/\$\{.*\}`, body, "PATCH"\)/);
    expect(dashboard).toContain("Shift updated.");
    expect(dashboard).toContain("Shift added.");
    expect(dashboard).not.toContain("owner_user_id");
    expect(dashboard).toContain("deleteFlow.request(target)");

    expect(sheet).toContain("draftFromTimeEntry");
    expect(sheet).toContain("shiftUpdatePayload");
    expect(sheet).toContain("editPreviewRateCents");
    expect(sheet).toContain("Correct this shift");
    expect(sheet).toContain("snapshots the current site rate");
    expect(sheet).toContain("shiftDateBounds(editing, data.weekStart, data.weekEnd)");
    expect(sheet).toContain("Add a completed shift");
    expect(sheet).toContain("ASSIGN_ANOTHER_SITE");
    expect(sheet).toContain("shiftSaveErrorMessage(cause, \"edit\")");
    expect(sheet).not.toContain("owner_user_id");
  });
});
