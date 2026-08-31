import { describe, expect, it, vi } from "vitest";
import {
  cancelShiftDelete,
  createShiftDeleteFlow,
  idleShiftDelete,
  requestShiftDelete,
  shiftDeletePrompt,
  shiftDeleteRequest,
} from "../src/lib/shift-delete";

const target = {
  id: "entry-1",
  contractorName: "Aroha",
  siteName: "Harbour Offices",
  workDate: "2026-08-31",
};

describe("shift delete confirmation", () => {
  it("identifies the contractor, site, and work date before any request", () => {
    const session = requestShiftDelete(target);
    const prompt = shiftDeletePrompt(session.target, "Mon, 31 August 2026");

    expect(session).toEqual({ phase: "confirming", target });
    expect(prompt.title).toBe("Delete this shift?");
    expect(prompt.description).toContain("Aroha");
    expect(prompt.description).toContain("Harbour Offices");
    expect(prompt.description).toContain("Mon, 31 August 2026");
    expect(prompt.confirmLabel).toBe("Delete shift");
    expect(prompt.cancelLabel).toBe("Cancel");
  });

  it("cancel and close return to idle without a DELETE request", async () => {
    const sendDelete = vi.fn();
    const flow = createShiftDeleteFlow(sendDelete);
    flow.request(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleShiftDelete);
    expect(cancelShiftDelete()).toEqual(idleShiftDelete);
    expect(sendDelete).not.toHaveBeenCalled();
  });

  it("confirm sends one owner-scoped DELETE and closes the dialog", async () => {
    const sendDelete = vi.fn(async () => undefined);
    const flow = createShiftDeleteFlow(sendDelete);
    flow.request(target);
    expect(shiftDeleteRequest(target)).toEqual({ method: "DELETE", url: "/api/time-entries/entry-1" });

    await flow.confirm();

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(sendDelete).toHaveBeenCalledWith({ method: "DELETE", url: "/api/time-entries/entry-1" });
    expect(flow.getSession()).toEqual(idleShiftDelete);
  });

  it("ignores a second confirm while the first DELETE is in flight", async () => {
    let finish!: () => void;
    const sendDelete = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createShiftDeleteFlow(sendDelete);
    flow.request(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleShiftDelete);
  });

  it("closes after a failed DELETE so existing error messaging can surface", async () => {
    const sendDelete = vi.fn(async () => { throw new Error("request_failed"); });
    const flow = createShiftDeleteFlow(sendDelete);
    flow.request(target);

    await expect(flow.confirm()).rejects.toThrow("request_failed");
    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleShiftDelete);
  });
});
