import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  canApproveWeek,
  canReopenWeek,
  cancelWeekApproval,
  createWeekApprovalFlow,
  expectedWeekTotals,
  idleWeekApproval,
  weekApprovalBadgeLabel,
  weekApprovalErrorMessage,
  weekApprovePrompt,
  weekApproveRequest,
  weekReopenPrompt,
  weekReopenRequest,
} from "../src/lib/week-approval";

const totals = { weekStart: "2026-08-31", expectedPaidMinutes: 480, expectedPayCents: 25_600 };

describe("week approval badge and gates", () => {
  it("labels open, approved, and reopened with visible text", () => {
    expect(weekApprovalBadgeLabel("open")).toBe("Open");
    expect(weekApprovalBadgeLabel("approved")).toBe("Approved & locked");
    expect(weekApprovalBadgeLabel("reopened")).toBe("Reopened");
  });

  it("allows approve on open and reopened, and reopen only when approved", () => {
    expect(canApproveWeek("open")).toBe(true);
    expect(canApproveWeek("reopened")).toBe(true);
    expect(canApproveWeek("approved")).toBe(false);
    expect(canReopenWeek("approved")).toBe(true);
    expect(canReopenWeek("open")).toBe(false);
    expect(canReopenWeek("reopened")).toBe(false);
  });
});

describe("week approval prompts and payloads", () => {
  it("includes the week range, paid duration, and NZD pay in approve copy", () => {
    const prompt = weekApprovePrompt({
      weekRangeLabel: "31 Aug – 6 Sep",
      paidDurationLabel: "8h 00m",
      payLabel: "NZ$256.00",
    });
    expect(prompt.title).toBe("Approve this week?");
    expect(prompt.description).toContain("31 Aug – 6 Sep");
    expect(prompt.description).toContain("8h 00m");
    expect(prompt.description).toContain("NZ$256.00");
    expect(prompt.confirmLabel).toBe("Approve week");
    expect(prompt.cancelLabel).toBe("Cancel");
    expect(prompt.closeLabel).toBe("Close approve confirmation");
  });

  it("tells the owner shifts can be edited again when reopening", () => {
    const prompt = weekReopenPrompt({ weekRangeLabel: "31 Aug – 6 Sep" });
    expect(prompt.title).toBe("Reopen this week?");
    expect(prompt.description).toContain("31 Aug – 6 Sep");
    expect(prompt.description.toLowerCase()).toContain("edited");
    expect(prompt.confirmLabel).toBe("Reopen week");
    expect(prompt.cancelLabel).toBe("Cancel");
    expect(prompt.closeLabel).toBe("Close reopen confirmation");
  });

  it("sums loaded summary rows into expected approve totals without an owner id", () => {
    expect(expectedWeekTotals([
      { paidMinutes: 120, payCents: 6_400 },
      { paidMinutes: 360, payCents: 19_200 },
    ])).toEqual({ expectedPaidMinutes: 480, expectedPayCents: 25_600 });
    expect(expectedWeekTotals([])).toEqual({ expectedPaidMinutes: 0, expectedPayCents: 0 });

    const approve = weekApproveRequest(totals);
    expect(approve).toEqual({
      method: "POST",
      url: "/api/weeks/approve",
      body: totals,
    });
    const reopen = weekReopenRequest({ weekStart: totals.weekStart });
    expect(reopen).toEqual({
      method: "POST",
      url: "/api/weeks/reopen",
      body: { weekStart: "2026-08-31" },
    });
    expect(JSON.stringify(approve)).not.toMatch(/owner_user_id|ownerUserId/);
    expect(JSON.stringify(reopen)).not.toMatch(/owner_user_id|ownerUserId/);
  });

  it("maps lock, stale, and not-approved failures to recoverable copy", () => {
    expect(weekApprovalErrorMessage("week_locked")).toBe(
      "This week is approved and locked. Reopen it before changing shifts.",
    );
    expect(weekApprovalErrorMessage("stale_week")).toBe(
      "This week's hours or pay changed. Reload and review again.",
    );
    expect(weekApprovalErrorMessage("week_not_approved")).toBe("This week is not approved yet.");
  });
});

describe("week approval confirmation flow", () => {
  it("cancel returns to idle without posting", async () => {
    const send = vi.fn();
    const flow = createWeekApprovalFlow(send);
    flow.requestApprove();
    expect(flow.getSession()).toEqual({ phase: "confirming-approve" });
    flow.cancel();
    await flow.confirm(totals);

    expect(flow.getSession()).toEqual(idleWeekApproval);
    expect(cancelWeekApproval()).toEqual(idleWeekApproval);
    expect(send).not.toHaveBeenCalled();
  });

  it("confirm approve sends one POST with the loaded expected totals", async () => {
    const send = vi.fn(async () => undefined);
    const flow = createWeekApprovalFlow(send);
    flow.requestApprove();
    await flow.confirm(totals);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/weeks/approve",
      body: {
        weekStart: "2026-08-31",
        expectedPaidMinutes: 480,
        expectedPayCents: 25_600,
      },
    });
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/owner_user_id|ownerUserId/);
    expect(flow.getSession()).toEqual(idleWeekApproval);
  });

  it("confirm reopen sends one POST with only weekStart", async () => {
    const send = vi.fn(async () => undefined);
    const flow = createWeekApprovalFlow(send);
    flow.requestReopen();
    expect(flow.getSession()).toEqual({ phase: "confirming-reopen" });
    await flow.confirm(totals);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/weeks/reopen",
      body: { weekStart: "2026-08-31" },
    });
    expect(JSON.stringify(send.mock.calls)).not.toMatch(/owner_user_id|ownerUserId/);
  });

  it("ignores a second confirm while the first request is in flight", async () => {
    let finish!: () => void;
    const send = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createWeekApprovalFlow(send);
    flow.requestApprove();

    const first = flow.confirm(totals);
    expect(flow.getSession()).toEqual({ phase: "submitting", kind: "approve" });
    const second = flow.confirm(totals);
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleWeekApproval);
  });
});

describe("dashboard week approval wiring", () => {
  const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
  const helper = fs.readFileSync(path.resolve("src/lib/week-approval.ts"), "utf8");
  const sheet = fs.readFileSync(path.resolve("src/components/shift-entry.tsx"), "utf8");

  it("does not send or derive owner_user_id in the browser", () => {
    expect(dashboard).not.toContain("owner_user_id");
    expect(helper).not.toContain("owner_user_id");
    expect(sheet).not.toContain("owner_user_id");
  });

  it("gates Approve and Reopen on status and posts to the week endpoints", () => {
    expect(dashboard).toContain("weekApprovalBadgeLabel");
    expect(dashboard).toContain("canApproveWeek");
    expect(dashboard).toContain("canReopenWeek");
    expect(dashboard).toMatch(/canApproveWeek\([^)]*\)\s*\?/);
    expect(dashboard).toMatch(/canReopenWeek\([^)]*\)\s*\?/);
    expect(dashboard).toContain("/api/weeks/approve");
    expect(dashboard).toContain("/api/weeks/reopen");
    expect(dashboard).toContain("expectedWeekTotals");
    expect(dashboard).toContain("Week approved.");
    expect(dashboard).toContain("Week reopened.");
    expect(dashboard).toContain("weekApprovalErrorMessage");
  });

  it("keeps approval controls out of shift rows and disables edit/delete when locked", () => {
    const rowStart = dashboard.indexOf("function ShiftRow");
    const rowEnd = dashboard.indexOf("function DeleteShiftDialog");
    const shiftRow = dashboard.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
    expect(shiftRow).not.toContain("Approve week");
    expect(shiftRow).not.toContain("Reopen week");
    expect(shiftRow).not.toContain("canApproveWeek");
    expect(shiftRow).toContain("disabled={locked}");
    expect(dashboard).toContain('locked={data.approval.status === "approved"}');
    expect(dashboard).toContain("if (locked) return");
  });

  it("hides create-shift when the week is locked", () => {
    expect(sheet).toMatch(/locked\?: boolean/);
    expect(sheet).toContain("locked && !editing");
    expect(sheet).not.toMatch(/locked && !editing[\s\S]{0,200}\+ Add shift/);
  });
});
