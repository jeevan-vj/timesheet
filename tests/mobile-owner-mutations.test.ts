import { describe, expect, it, vi } from "vitest";
import { occurrenceExceptionInput } from "@cleantrack/core";
import type { OwnerEntry } from "@cleantrack/core";
import {
  OWNER_SHIFT_ACTIONS_ENABLED,
  OWNER_SHIFT_MUTATION_MESSAGES,
  ownerShiftActionsState,
  ownerShiftExceptionBody,
  ownerShiftExceptionPath,
  ownerShiftPaidMinutesError,
  runOwnerShiftException,
  type OwnerShiftAction,
} from "../apps/mobile/src/owner-mutations";

const entry = {
  id: "entry_1",
  occurrenceKind: "scheduled",
} as OwnerEntry;

describe("mobile owner shift mutations", () => {
  it("keeps mobile payroll mutations hard-disabled pending audit and release review", () => {
    expect(OWNER_SHIFT_ACTIONS_ENABLED).toBe(false);
  });

  it("does not offer Worked as an implicit reset of custom paid hours", () => {
    const state = ownerShiftActionsState({ occurrenceKind: "hours_override" }, "open");
    expect(state.actions.find((item) => item.action === "worked")).toMatchObject({
      enabled: false,
      reason: expect.stringMatching(/custom paid hours/i),
    });
    expect(state.actions.find((item) => item.action === "reset_pending")).toMatchObject({
      enabled: true,
      label: "Reset to pending (restore scheduled hours)",
    });
  });

  it.each<[OwnerShiftAction, number | undefined, object]>([
    ["worked", undefined, { kind: "confirm_worked", scope: "this_day" }],
    ["did_not_work", undefined, { kind: "absent", scope: "this_day" }],
    ["reset_pending", undefined, { kind: "worked_as_scheduled", scope: "this_day" }],
    ["change_hours", 75, { kind: "hours_override", paidMinutes: 75, scope: "this_day" }],
  ])("builds the exact %s body accepted by core validation", (action, paidMinutes, expected) => {
    const body = ownerShiftExceptionBody(action, paidMinutes);
    expect(body).toEqual(expected);
    expect(occurrenceExceptionInput.safeParse(body).success).toBe(true);
  });

  it("validates override minutes at the same-day integer bounds", () => {
    expect(ownerShiftPaidMinutesError(0)).toBeTruthy();
    expect(ownerShiftPaidMinutesError(1)).toBeNull();
    expect(ownerShiftPaidMinutesError(1_439)).toBeNull();
    expect(ownerShiftPaidMinutesError(1_440)).toBeTruthy();
    expect(ownerShiftPaidMinutesError(60.5)).toBeTruthy();
    expect(() => ownerShiftExceptionBody("change_hours", 0)).toThrow(/whole number of minutes/i);
  });

  it("builds only a validated time-entry exception path", () => {
    expect(ownerShiftExceptionPath("entry_1-A")).toBe("/api/time-entries/entry_1-A/exception");
    for (const id of ["", "a/b", "../entry", "x".repeat(65)]) {
      expect(() => ownerShiftExceptionPath(id)).toThrow(/shift is not available/i);
    }
  });

  it("disables approved actions, enables open and reopened actions, and omits manual actions", () => {
    const approved = ownerShiftActionsState(entry, "approved");
    expect(approved.actions).toHaveLength(4);
    expect(approved.actions.every((action) => !action.enabled)).toBe(true);
    expect(approved.reason).toMatch(/approved and locked/i);

    for (const status of ["open", "reopened"] as const) {
      const state = ownerShiftActionsState(entry, status);
      expect(state.actions.find((action) => action.action === "worked")?.enabled).toBe(true);
      expect(state.actions.find((action) => action.action === "change_hours")?.enabled).toBe(true);
      expect(state.actions.find((action) => action.action === "reset_pending")?.enabled).toBe(false);
    }

    const pending = ownerShiftActionsState(entry, "open").actions.find((action) => action.action === "reset_pending");
    expect(pending?.reason).toBe("This shift is already pending.");
    const absent = ownerShiftActionsState({ ...entry, occurrenceKind: "absent" }, "open").actions;
    expect(absent.find((action) => action.action === "did_not_work")).toMatchObject({
      enabled: false,
      reason: "This shift is already marked didn't work.",
    });
    expect(absent.find((action) => action.action === "reset_pending")?.enabled).toBe(true);

    const manual = ownerShiftActionsState({ ...entry, occurrenceKind: "manual" }, "open");
    expect(manual.actions).toEqual([]);
    expect(manual.reason).toBe("One-off shifts can be changed on the web dashboard.");
  });

  it("maps a locked week and sends one JSON request", async () => {
    const send = vi.fn(async () => ({ status: 409, body: { error: "week_locked" } }));
    const result = await runOwnerShiftException("entry_1", "worked", undefined, send);
    expect(result).toEqual({
      ok: false,
      error: { code: "week_locked", message: OWNER_SHIFT_MUTATION_MESSAGES.weekLocked },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("/api/time-entries/entry_1/exception", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "confirm_worked", scope: "this_day" }),
    });
  });

  it("maps no-schedule and network failures", async () => {
    await expect(runOwnerShiftException(
      "entry_1",
      "worked",
      undefined,
      async () => ({ status: 409, body: { error: "no_schedule" } }),
    )).resolves.toEqual({
      ok: false,
      error: { code: "no_schedule", message: OWNER_SHIFT_MUTATION_MESSAGES.noSchedule },
    });
    await expect(runOwnerShiftException("entry_1", "worked", undefined, async () => {
      throw new TypeError("network");
    })).resolves.toEqual({
      ok: false,
      error: { code: "offline", message: OWNER_SHIFT_MUTATION_MESSAGES.offline },
    });
  });

  it.each([
    [401, { error: "unauthorized" }, "unauthorized", OWNER_SHIFT_MUTATION_MESSAGES.unauthorized],
    [404, { error: "not_found" }, "not_found", OWNER_SHIFT_MUTATION_MESSAGES.notFound],
    [400, { error: "invalid_request" }, "invalid_request", OWNER_SHIFT_MUTATION_MESSAGES.invalidRequest],
    [409, { error: "duplicate_entry" }, "duplicate_entry", OWNER_SHIFT_MUTATION_MESSAGES.duplicateEntry],
    [500, { error: "internal_error" }, "unavailable", OWNER_SHIFT_MUTATION_MESSAGES.unavailable],
  ] as const)("maps status %s without exposing response details", async (status, body, code, message) => {
    await expect(runOwnerShiftException(
      "entry_1",
      "worked",
      undefined,
      async () => ({ status, body }),
    )).resolves.toEqual({ ok: false, error: { code, message } });
  });
});
