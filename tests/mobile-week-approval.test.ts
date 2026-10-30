import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  OWNER_WEEK_APPROVAL_MESSAGES,
  ownerWeekApprovalRequest,
  runOwnerWeekApproval,
} from "../apps/mobile/src/week-approval";

describe("mobile owner week approval", () => {
  it("is available from both owner Week and Payroll", () => {
    for (const file of [
      "apps/mobile/src/app/(owner)/(tabs)/week.tsx",
      "apps/mobile/src/app/(owner)/(tabs)/payroll.tsx",
    ]) {
      expect(readFileSync(file, "utf8")).toContain("OwnerWeekApproval");
    }
  });
  it("builds exact approve and reopen requests from Monday week totals", () => {
    expect(ownerWeekApprovalRequest({
      action: "approve",
      weekStart: "2026-10-26",
      expectedPaidMinutes: 480,
      expectedPayCents: 24_000,
    })).toEqual({
      path: "/api/weeks/approve",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart: "2026-10-26", expectedPaidMinutes: 480, expectedPayCents: 24_000 }),
      },
    });
    expect(ownerWeekApprovalRequest({ action: "reopen", weekStart: "2026-10-26" })).toEqual({
      path: "/api/weeks/reopen",
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart: "2026-10-26" }),
      },
    });
  });

  it("rejects invalid weeks and totals before sending", () => {
    expect(() => ownerWeekApprovalRequest({
      action: "approve",
      weekStart: "2026-10-27",
      expectedPaidMinutes: 480,
      expectedPayCents: 24_000,
    })).toThrow(/Monday/i);
    expect(() => ownerWeekApprovalRequest({
      action: "approve",
      weekStart: "2026-10-26",
      expectedPaidMinutes: -1,
      expectedPayCents: 24_000,
    })).toThrow(/totals/i);
  });

  it("maps stale totals without retrying the mutation", async () => {
    const send = vi.fn(async () => ({ status: 409, body: { error: "stale_week" } }));
    await expect(runOwnerWeekApproval({
      action: "approve",
      weekStart: "2026-10-26",
      expectedPaidMinutes: 480,
      expectedPayCents: 24_000,
    }, send)).resolves.toEqual({
      ok: false,
      error: { code: "stale_week", message: OWNER_WEEK_APPROVAL_MESSAGES.staleWeek },
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("maps locked, not-approved, signed-out, malformed, and offline failures", async () => {
    for (const [status, code, expected] of [
      [409, "week_locked", "week_locked"],
      [409, "week_not_approved", "week_not_approved"],
      [401, "unauthorized", "unauthorized"],
      [400, "invalid_request", "invalid_request"],
    ] as const) {
      await expect(runOwnerWeekApproval(
        { action: "reopen", weekStart: "2026-10-26" },
        async () => ({ status, body: { error: code } }),
      )).resolves.toMatchObject({ ok: false, error: { code: expected } });
    }
    await expect(runOwnerWeekApproval(
      { action: "reopen", weekStart: "2026-10-26" },
      async () => { throw new TypeError("network"); },
    )).resolves.toMatchObject({ ok: false, error: { code: "offline" } });
  });
});
