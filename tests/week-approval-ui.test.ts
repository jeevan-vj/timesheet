import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cancelWeekApproval,
  createWeekApprovalFlow,
  dashboardMutationMessage,
  idleWeekApproval,
  requestApprove,
  requestReopen,
  weekApprovalPrompt,
  weekApprovalRequest,
  weekApprovalStatusView,
  weekApprovalSuccessMessage,
  type WeekApprovalTarget,
} from "../src/lib/week-approval";

const target: WeekApprovalTarget = {
  weekStart: "2026-08-31",
  weekRangeLabel: "31 Aug – 6 Sep",
  paidHoursLabel: "8h 00m",
  payLabel: "NZ$240.00",
  expectedPaidMinutes: 480,
  expectedPayCents: 24_000,
};

const emptyTarget: WeekApprovalTarget = {
  weekStart: "2026-08-31",
  weekRangeLabel: "31 Aug – 6 Sep",
  paidHoursLabel: "0h 00m",
  payLabel: "NZ$0.00",
  expectedPaidMinutes: 0,
  expectedPayCents: 0,
};

describe("week approval confirmation", () => {
  it("identifies the Monday–Sunday range, paid hours, and NZD pay before any request", () => {
    const session = requestApprove(target);
    const prompt = weekApprovalPrompt(session.action, session.target);

    expect(session).toEqual({ phase: "confirm-approve", action: "approve", target });
    expect(prompt.title).toBe("Approve this week?");
    expect(prompt.description).toContain("31 Aug – 6 Sep");
    expect(prompt.description).toMatch(/Monday/);
    expect(prompt.description).toMatch(/Sunday/);
    expect(prompt.description).toContain("8h 00m");
    expect(prompt.description).toContain("NZ$240.00");
    expect(prompt.confirmLabel).toBe("Approve week");
    expect(prompt.cancelLabel).toBe("Cancel");
    expect(prompt.closeLabel).toBe("Close approve confirmation");
  });

  it("allows approving an empty week at 0 hours and NZ$0.00", () => {
    const prompt = weekApprovalPrompt("approve", emptyTarget);
    expect(prompt.description).toContain("0h 00m");
    expect(prompt.description).toContain("NZ$0.00");
    expect(weekApprovalRequest("approve", emptyTarget).body).toEqual({
      expectedPaidMinutes: 0,
      expectedPayCents: 0,
    });
  });

  it("names reopen confirmation with the same week totals", () => {
    const session = requestReopen(target);
    const prompt = weekApprovalPrompt(session.action, session.target);

    expect(session).toEqual({ phase: "confirm-reopen", action: "reopen", target });
    expect(prompt.title).toBe("Reopen this week?");
    expect(prompt.description).toContain("31 Aug – 6 Sep");
    expect(prompt.description).toContain("8h 00m");
    expect(prompt.description).toContain("NZ$240.00");
    expect(prompt.confirmLabel).toBe("Reopen week");
    expect(prompt.closeLabel).toBe("Close reopen confirmation");
  });

  it("cancel and close return to idle without a POST", async () => {
    const sendRequest = vi.fn();
    const flow = createWeekApprovalFlow(sendRequest);
    flow.requestApprove(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleWeekApproval);
    expect(cancelWeekApproval()).toEqual(idleWeekApproval);
    expect(sendRequest).not.toHaveBeenCalled();
  });

  it("confirm sends one POST with integer expected totals and the approve URL", async () => {
    const sendRequest = vi.fn(async () => undefined);
    const flow = createWeekApprovalFlow(sendRequest);
    flow.requestApprove(target);
    expect(weekApprovalRequest("approve", target)).toEqual({
      method: "POST",
      url: "/api/weeks/2026-08-31/approve",
      body: { expectedPaidMinutes: 480, expectedPayCents: 24_000 },
    });

    await flow.confirm();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/weeks/2026-08-31/approve",
      body: { expectedPaidMinutes: 480, expectedPayCents: 24_000 },
    });
    expect(flow.getSession()).toEqual(idleWeekApproval);
  });

  it("confirm reopen posts once to the reopen URL with the displayed integers", async () => {
    const sendRequest = vi.fn(async () => undefined);
    const flow = createWeekApprovalFlow(sendRequest);
    flow.requestReopen(target);
    expect(weekApprovalRequest("reopen", target)).toEqual({
      method: "POST",
      url: "/api/weeks/2026-08-31/reopen",
      body: { expectedPaidMinutes: 480, expectedPayCents: 24_000 },
    });

    await flow.confirm();

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(sendRequest).toHaveBeenCalledWith({
      method: "POST",
      url: "/api/weeks/2026-08-31/reopen",
      body: { expectedPaidMinutes: 480, expectedPayCents: 24_000 },
    });
  });

  it("ignores a second confirm while the first POST is in flight", async () => {
    let finish!: () => void;
    const sendRequest = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createWeekApprovalFlow(sendRequest);
    flow.requestApprove(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleWeekApproval);
  });

  it("closes after a failed POST so existing error messaging can surface", async () => {
    const sendRequest = vi.fn(async () => { throw new Error("stale_week_totals"); });
    const flow = createWeekApprovalFlow(sendRequest);
    flow.requestApprove(target);

    await expect(flow.confirm()).rejects.toThrow("stale_week_totals");
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleWeekApproval);
  });
});

describe("week approval status and errors", () => {
  it("labels never-approved and reopened weeks as Open without a third status", () => {
    expect(weekApprovalStatusView({ status: "open", approvedAt: null, reopenedAt: null })).toEqual({
      label: "Open",
      note: null,
    });
    expect(weekApprovalStatusView({
      status: "open",
      approvedAt: "2026-09-01T00:00:00.000Z",
      reopenedAt: "2026-09-02T00:00:00.000Z",
    }, "2 Sep 2026")).toEqual({
      label: "Open",
      note: "Last reopened 2 Sep 2026",
    });
    expect(weekApprovalStatusView({
      status: "approved",
      approvedAt: "2026-09-01T00:00:00.000Z",
      reopenedAt: null,
    })).toEqual({
      label: "Approved / locked",
      note: null,
    });
  });

  it("maps lock and stale-total conflicts to specific copy, not duplicate-assignment wording", () => {
    const generic = "duplicate or missing assignment";
    expect(dashboardMutationMessage(new Error("week_locked"))).toMatch(/locked/i);
    expect(dashboardMutationMessage(new Error("week_locked"))).toMatch(/reopen/i);
    expect(dashboardMutationMessage(new Error("week_already_approved"))).toMatch(/already approved/i);
    expect(dashboardMutationMessage(new Error("week_not_approved"))).toMatch(/not approved/i);
    expect(dashboardMutationMessage(new Error("stale_week_totals"))).toMatch(/refresh/i);
    expect(dashboardMutationMessage(new Error("stale_week_totals"))).toMatch(/hours|pay/i);
    expect(dashboardMutationMessage(new Error("week_locked"))).not.toContain(generic);
    expect(dashboardMutationMessage(new Error("week_already_approved"))).not.toContain(generic);
    expect(dashboardMutationMessage(new Error("week_not_approved"))).not.toContain(generic);
    expect(dashboardMutationMessage(new Error("stale_week_totals"))).not.toContain(generic);
    expect(dashboardMutationMessage(new Error("invalid_shift"))).toContain("positive paid shift");
    expect(dashboardMutationMessage(new Error("duplicate_entry"))).toContain(generic);
  });

  it("exposes success copy for approve and reopen", () => {
    expect(weekApprovalSuccessMessage.approved).toBe("Week approved and locked.");
    expect(weekApprovalSuccessMessage.reopened).toBe("Week reopened.");
  });
});

describe("week approval browser contract", () => {
  const helper = fs.readFileSync(path.resolve("src/lib/week-approval.ts"), "utf8");
  const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
  const sheet = fs.readFileSync(path.resolve("src/components/shift-entry.tsx"), "utf8");
  const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");

  it("never mentions owner_user_id in helper, request body, or dashboard", () => {
    expect(helper).not.toContain("owner_user_id");
    expect(JSON.stringify(weekApprovalRequest("approve", target))).not.toContain("owner_user_id");
    expect(JSON.stringify(weekApprovalRequest("reopen", target))).not.toContain("owner_user_id");
    expect(Object.keys(weekApprovalRequest("approve", target).body).sort()).toEqual([
      "expectedPaidMinutes",
      "expectedPayCents",
    ]);
    expect(dashboard).not.toContain("owner_user_id");
    expect(sheet).not.toContain("owner_user_id");
  });

  it("wires labelled confirmation onto the weekly dashboard", () => {
    expect(dashboard).toContain("Approve week");
    expect(dashboard).toContain("Reopen week");
    expect(dashboard).toContain("Approved / locked");
    expect(dashboard).toContain("weekApprovalSuccessMessage.approved");
    expect(dashboard).toContain("weekApprovalSuccessMessage.reopened");
    expect(dashboard).toContain("week-approval-title");
    expect(dashboard).toContain("week-approval-copy");
    expect(dashboard).toContain("autoFocus");
    expect(dashboard).toContain("createWeekApprovalFlow");
    expect(dashboard).toContain("locked={weekLocked}");
    expect(dashboard).toContain("disabled={locked}");
    expect(sheet).toContain("locked");
    expect(css).toContain(".week-approval-dialog");
    expect(css).toContain(".week-status-badge");
  });
});
