import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PortalShiftSubmission } from "../packages/core/src/portal";
import {
  CONTRACTOR_SHIFT_ACTIONS,
  CONTRACTOR_SHIFT_MESSAGES,
  contractorShiftEditor,
  contractorShiftStatusBody,
  replacePortalShift,
  runContractorShiftStatus,
  statusAfterAttempt,
} from "../apps/mobile/src/contractor-shift";

const shift = {
  id: "entry-a",
  businessId: "biz_owner-a",
  businessName: "Northwind",
  siteName: "Queen Street",
  address: "12 Queen Street",
  workDate: "2026-10-26",
  paidMinutes: 90,
  entryMode: "paid_hours",
  occurrenceKind: "scheduled",
  startMinutes: null,
  endMinutes: null,
  breakMinutes: null,
  locked: false,
  recorded: true,
  reason: "",
} satisfies PortalShiftSubmission;

function saved(kind: PortalShiftSubmission["occurrenceKind"], paidMinutes = 90): PortalShiftSubmission {
  return { ...shift, occurrenceKind: kind, paidMinutes };
}

describe("mobile contractor shift status", () => {
  it("offers the three text actions only for an editable recorded shift", () => {
    expect(contractorShiftEditor(shift)).toEqual({ mode: "edit" });
    expect(CONTRACTOR_SHIFT_ACTIONS.map((item) => item.label)).toEqual([
      "Worked as scheduled",
      "Didn't work",
      "Worked different hours",
    ]);
    expect(contractorShiftEditor({ ...shift, locked: true })).toEqual({
      mode: "locked",
      message: CONTRACTOR_SHIFT_MESSAGES.locked,
    });
    expect(contractorShiftEditor({ ...shift, recorded: false }).mode).toBe("unrecorded");
    expect(contractorShiftEditor({ occurrenceKind: "scheduled", id: "entry-a" }).mode).toBe("edit");
    expect(contractorShiftEditor({ occurrenceKind: "scheduled", id: "sched_v-a_2026-10-28" }).mode).toBe("unrecorded");
    expect(contractorShiftEditor({ ...shift, occurrenceKind: "manual" }).mode).toBe("employer_recorded");
  });

  it("builds a body with no contractor, business, rate, or schedule fields", () => {
    expect(contractorShiftStatusBody("worked_as_scheduled")).toEqual({ action: "worked_as_scheduled" });
    expect(contractorShiftStatusBody("absent")).toEqual({ action: "absent" });
    expect(contractorShiftStatusBody("different_hours", { paidMinutes: 75, reason: " Finished early " })).toEqual({
      action: "different_hours",
      paidMinutes: 75,
      reason: "Finished early",
    });
    expect(contractorShiftStatusBody("different_hours", { paidMinutes: 75, reason: "   " })).toEqual({
      action: "different_hours",
      paidMinutes: 75,
    });
  });

  it("keeps the previous status when the mutation fails", async () => {
    let calls = 0;
    const failed = await runContractorShiftStatus("entry-a", "absent", undefined, async () => {
      calls += 1;
      return { status: 500, body: { error: "internal_error" } };
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.error.code).toBe("unavailable");
    expect(statusAfterAttempt(shift, failed)).toBe("scheduled");
    expect(calls).toBe(1);

    const locked = await runContractorShiftStatus("entry-a", "absent", undefined, async () => ({
      status: 409,
      body: { error: "week_locked" },
    }));
    expect(locked).toMatchObject({ ok: false, error: { code: "week_locked", message: CONTRACTOR_SHIFT_MESSAGES.weekLocked } });
    expect(statusAfterAttempt(shift, locked)).toBe("scheduled");

    const unreadable = await runContractorShiftStatus("entry-a", "worked_as_scheduled", undefined, async () => ({
      status: 200,
      body: { saved: true },
    }));
    expect(statusAfterAttempt(shift, unreadable)).toBe("scheduled");
  });

  it("does not send a status update while offline", async () => {
    let calls = 0;
    const result = await runContractorShiftStatus("entry-a", "worked_as_scheduled", undefined, async () => {
      calls += 1;
      return { status: 200, body: saved("worked") };
    }, { online: false });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ ok: false, error: { code: "offline" } });
    expect(statusAfterAttempt(shift, result)).toBe("scheduled");
  });

  it("reconciles a successful response into the week and replaces the pending task", async () => {
    const result = await runContractorShiftStatus("entry-a", "worked_as_scheduled", undefined, async (_path, init) => {
      expect(JSON.parse(init.body)).toEqual({ action: "worked_as_scheduled" });
      return { status: 200, body: saved("worked") };
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(statusAfterAttempt(shift, result)).toBe("worked");
    const week = replacePortalShift({
      weekStart: "2026-10-26",
      weekEnd: "2026-11-01",
      days: [{ date: "2026-10-26", shifts: [shift] }],
      tasks: [{ id: "pending-shifts", title: "1 shift still pending", detail: "These are on your schedule and not marked worked yet." }],
    }, result.shift);
    expect(week?.days[0]?.shifts[0]?.occurrenceKind).toBe("worked");
    expect(week?.tasks).toEqual([]);
  });

  it("shows text actions, a text status, and 44pt targets on My week", () => {
    const week = readFileSync("apps/mobile/src/app/(contractor)/(tabs)/week.tsx", "utf8");
    const sheet = readFileSync("apps/mobile/src/components/contractor-shift-sheet.tsx", "utf8");
    const actions = readFileSync("apps/mobile/src/contractor-shift.ts", "utf8");
    expect(week).toContain("ContractorShiftSheet");
    expect(week).toContain("title=\"My week\"");
    expect(sheet).toContain("CONTRACTOR_SHIFT_ACTIONS.map");
    expect(sheet).toContain("item.label");
    for (const label of ["Worked as scheduled", "Didn't work", "Worked different hours"]) {
      expect(actions).toContain(label);
    }
    expect(sheet).toContain("Current status");
    expect(sheet).toContain("StatusPill");
    expect(sheet).toContain("accessibilityRole=\"alert\"");
    expect(sheet).toContain("minHeight: theme.touchTarget");
    expect(sheet).not.toContain("rateCents");
    expect(sheet).not.toContain("contractorId");
  });
});
