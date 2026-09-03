import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  assignmentCreateSuccess,
  assignmentMutationMessage,
  assignmentRateLabel,
  assignmentStatusLabel,
  cancelUnassignAssignment,
  canRestoreAssignment,
  createUnassignAssignmentFlow,
  idleUnassignAssignment,
  parseAssignmentOverride,
  presentAssignment,
  requestUnassignAssignment,
  unassignAssignmentPrompt,
  unassignAssignmentRequest,
  type AssignmentItemDTO,
} from "../src/lib/assignment-manage";

const activeInherited: AssignmentItemDTO = {
  id: "a1",
  contractorId: "c1",
  contractorName: "Aroha",
  siteId: "s1",
  siteName: "Harbour Offices",
  rateCents: null,
  effectiveRateCents: 3_200,
  rateInherited: true,
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  schedule: null,
};

const archivedOverride: AssignmentItemDTO = {
  id: "a2",
  contractorId: "c2",
  contractorName: "Moana",
  siteId: "s2",
  siteName: "Warehouse",
  rateCents: 4_000,
  effectiveRateCents: 4_000,
  rateInherited: false,
  active: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-03-01T00:00:00.000Z",
  schedule: null,
};

const target = {
  id: "a1",
  contractorName: "Aroha",
  siteName: "Harbour Offices",
};

describe("assignment list presentation", () => {
  it("maps names, NZD effective rate, inherited vs override, and archived flag", () => {
    const inherited = presentAssignment(activeInherited);
    expect(inherited.contractorName).toBe("Aroha");
    expect(inherited.siteName).toBe("Harbour Offices");
    expect(inherited.rateLabel).toBe("NZ$32/hr default");
    expect(inherited.statusLabel).toBe("Active");
    expect(inherited.archived).toBe(false);
    expect(assignmentStatusLabel(true)).toBe("Active");
    expect(assignmentRateLabel({ rateInherited: true, effectiveRateCents: 3_200 })).toBe("NZ$32/hr default");

    const archived = presentAssignment(archivedOverride);
    expect(archived.contractorName).toBe("Moana");
    expect(archived.siteName).toBe("Warehouse");
    expect(archived.rateLabel).toBe("NZ$40/hr override");
    expect(archived.statusLabel).toBe("Archived");
    expect(archived.archived).toBe(true);
    expect(assignmentStatusLabel(false)).toBe("Archived");
    expect(assignmentRateLabel({ rateInherited: false, effectiveRateCents: 4_000 })).toBe("NZ$40/hr override");
    expect(inherited.scheduleSummary).toBeNull();
    expect(inherited.detail).toBe("NZ$32/hr default · Active");
  });

  it("summarizes an open schedule as rate · weekdays · duration/day", () => {
    const scheduled = presentAssignment({
      ...activeInherited,
      contractorName: "Pasindhu",
      siteName: "Whitford",
      schedule: { id: "sv1", weekdays: [1, 2, 3, 4, 5], paidMinutes: 90, effectiveFrom: "2026-08-31" },
    });
    expect(scheduled.heading).toBe("Pasindhu — Whitford");
    expect(scheduled.scheduleSummary).toBe("NZ$32/hr · Mon–Fri · 1h 30m/day");
    expect(scheduled.detail).toBe("NZ$32/hr · Mon–Fri · 1h 30m/day");
  });
});

describe("unassign assignment confirmation", () => {
  it("identifies the contractor and site and states recorded shifts remain", () => {
    const session = requestUnassignAssignment(target);
    const prompt = unassignAssignmentPrompt(session.target);

    expect(session).toEqual({ phase: "confirming", target });
    expect(prompt.title).toBe("Unassign this contractor?");
    expect(prompt.description).toContain("Aroha");
    expect(prompt.description).toContain("Harbour Offices");
    expect(prompt.description).toMatch(/recorded shifts stay/i);
    expect(prompt.confirmLabel).toBe("Unassign");
    expect(prompt.cancelLabel).toBe("Cancel");
  });

  it("cancel and close return to idle without a DELETE request", async () => {
    const sendDelete = vi.fn();
    const flow = createUnassignAssignmentFlow(sendDelete);
    flow.request(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleUnassignAssignment);
    expect(cancelUnassignAssignment()).toEqual(idleUnassignAssignment);
    expect(sendDelete).not.toHaveBeenCalled();
  });

  it("confirm sends one owner-scoped DELETE and closes the dialog", async () => {
    const sendDelete = vi.fn(async () => undefined);
    const flow = createUnassignAssignmentFlow(sendDelete);
    flow.request(target);
    expect(unassignAssignmentRequest(target.id)).toEqual({ method: "DELETE", url: "/api/assignments/a1" });

    await flow.confirm();

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(sendDelete).toHaveBeenCalledWith({ method: "DELETE", url: "/api/assignments/a1" });
    expect(flow.getSession()).toEqual(idleUnassignAssignment);
  });

  it("ignores a second confirm while the first DELETE is in flight", async () => {
    let finish!: () => void;
    const sendDelete = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createUnassignAssignmentFlow(sendDelete);
    flow.request(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleUnassignAssignment);
  });

  it("closes after a failed DELETE so existing error messaging can surface", async () => {
    const sendDelete = vi.fn(async () => { throw new Error("request_failed"); });
    const flow = createUnassignAssignmentFlow(sendDelete);
    flow.request(target);

    await expect(flow.confirm()).rejects.toThrow("request_failed");
    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleUnassignAssignment);
  });
});

describe("assignment mutation copy", () => {
  it("announces restore when POST create reuses an archived pair", () => {
    expect(assignmentCreateSuccess(201)).toBe("Assignment added.");
    expect(assignmentCreateSuccess(200)).toBe("Assignment restored.");
  });

  it("maps duplicate, missing/inactive, validation, and generic failure copy", () => {
    expect(assignmentMutationMessage("duplicate_assignment")).toBe("That contractor is already assigned to this site.");
    expect(assignmentMutationMessage("not_found")).toBe("That contractor or site is missing or inactive.");
    expect(assignmentMutationMessage("invalid_request")).toBe("Check the rate is between NZ$15 and NZ$250.");
    expect(assignmentMutationMessage("schedule_exists")).toMatch(/already has a repeating schedule/i);
    expect(assignmentMutationMessage("no_schedule")).toMatch(/does not have a repeating schedule/i);
    expect(assignmentMutationMessage("request_failed")).toBe("That assignment could not be saved. Please try again.");
    expect(assignmentMutationMessage(undefined)).toBe("That assignment could not be saved. Please try again.");
  });
});

describe("restore eligibility", () => {
  it("disables restore when the contractor or site is missing from active dashboard lists", () => {
    const archived = { contractorId: "c1", siteId: "s1", active: false as const };
    expect(canRestoreAssignment(archived, ["c1"], ["s1"])).toBe(true);
    expect(canRestoreAssignment(archived, ["c2"], ["s1"])).toBe(false);
    expect(canRestoreAssignment(archived, ["c1"], ["s2"])).toBe(false);
    expect(canRestoreAssignment(archived, [], [])).toBe(false);
    expect(canRestoreAssignment({ ...archived, active: true }, ["c1"], ["s1"])).toBe(false);
  });
});

describe("optional assignment override parse", () => {
  it("treats blank as null, valid dollars as cents, and out-of-range as invalid", () => {
    expect(parseAssignmentOverride("")).toBeNull();
    expect(parseAssignmentOverride("32")).toBe(3_200);
    expect(parseAssignmentOverride("14.99")).toBe("invalid");
    expect(parseAssignmentOverride("250.01")).toBe("invalid");
  });
});

describe("assignment schedule editor wiring", () => {
  it("offers Edit schedule on active assignments and does not copy the previous week", () => {
    const assignments = fs.readFileSync(path.resolve("src/components/assignments.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    expect(assignments).toContain("Edit schedule");
    expect(assignments).toContain("weekStart");
    expect(assignments).toContain("weekLocked");
    expect(assignments).toContain("/api/assignments/${");
    expect(assignments).not.toMatch(/copy previous week/i);
    expect(dashboard).not.toMatch(/copy previous week/i);
  });
});
