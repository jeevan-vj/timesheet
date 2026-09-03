import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  cancelSiteArchive,
  completeSiteMutation,
  createSiteArchiveFlow,
  idleSiteArchive,
  readSiteList,
  requestSiteArchive,
  siteArchivePrompt,
  siteArchiveRequest,
  siteMutationFeedback,
  siteRestoreRequest,
  siteRowActions,
  siteSaveErrorMessage,
  sitesListUrl,
} from "../src/lib/site-setup";

const target = { id: "site-1", name: "Harbour Offices" };

describe("sites list URL", () => {
  it("requests active sites by default and archived only for includeArchived=1", () => {
    expect(sitesListUrl(false)).toBe("/api/sites");
    expect(sitesListUrl()).toBe("/api/sites");
    expect(sitesListUrl(true)).toBe("/api/sites?includeArchived=1");
  });
});

describe("site archive confirmation", () => {
  it("names the site and states assignment deactivation plus historical shifts remaining", () => {
    const session = requestSiteArchive(target);
    const prompt = siteArchivePrompt(session.target);

    expect(session).toEqual({ phase: "confirming", target });
    expect(prompt.title).toBe("Archive this site?");
    expect(prompt.description).toContain("Harbour Offices");
    expect(prompt.description.toLowerCase()).toContain("assignments");
    expect(prompt.description.toLowerCase()).toContain("deactivat");
    expect(prompt.description.toLowerCase()).toContain("historical");
    expect(prompt.description.toLowerCase()).toContain("shift");
    expect(prompt.confirmLabel).toBe("Archive site");
    expect(prompt.cancelLabel).toBe("Cancel");
  });

  it("cancel and close return to idle without a DELETE request", async () => {
    const sendDelete = vi.fn();
    const flow = createSiteArchiveFlow(sendDelete);
    flow.request(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleSiteArchive);
    expect(cancelSiteArchive()).toEqual(idleSiteArchive);
    expect(sendDelete).not.toHaveBeenCalled();
  });

  it("confirm sends one owner-scoped DELETE and closes the dialog", async () => {
    const sendDelete = vi.fn(async () => undefined);
    const flow = createSiteArchiveFlow(sendDelete);
    flow.request(target);
    expect(siteArchiveRequest(target)).toEqual({ method: "DELETE", url: "/api/sites/site-1" });

    await flow.confirm();

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(sendDelete).toHaveBeenCalledWith({ method: "DELETE", url: "/api/sites/site-1" });
    expect(flow.getSession()).toEqual(idleSiteArchive);
  });

  it("ignores a second confirm while the first DELETE is in flight", async () => {
    let finish!: () => void;
    const sendDelete = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createSiteArchiveFlow(sendDelete);
    flow.request(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleSiteArchive);
  });

  it("closes after a failed DELETE so existing error messaging can surface", async () => {
    const sendDelete = vi.fn(async () => { throw new Error("request_failed"); });
    const flow = createSiteArchiveFlow(sendDelete);
    flow.request(target);

    await expect(flow.confirm()).rejects.toThrow("request_failed");
    expect(sendDelete).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleSiteArchive);
  });
});

describe("site restore request", () => {
  it("posts restore to the same site row", () => {
    expect(siteRestoreRequest(target)).toEqual({ method: "POST", url: "/api/sites/site-1/restore" });
  });
});

describe("site list fetch failures", () => {
  it("treats a rejected fetch as an error instead of hanging on loading", async () => {
    await expect(readSiteList(async () => { throw new TypeError("Failed to fetch"); })).resolves.toEqual({ status: "error" });
  });

  it("treats invalid JSON as an error", async () => {
    await expect(readSiteList(async () => new Response("nope", { status: 200 }))).resolves.toEqual({ status: "error" });
  });
});

describe("site mutation refresh failures", () => {
  it("does not treat a refresh failure as a save failure", async () => {
    const result = await completeSiteMutation(async () => undefined, async () => { throw new Error("Failed to fetch"); });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refresh failure");
    expect(result.phase).toBe("refresh");
    const feedback = siteMutationFeedback(result, "Site added.");
    expect(feedback.saved).toBe(true);
    expect(feedback.kind).toBe("warning");
    expect(feedback.message.toLowerCase()).not.toContain("could not save");
    expect(feedback.message.toLowerCase()).toMatch(/refresh|reload/);
  });

  it("keeps duplicate and validation failures on the save path", async () => {
    const result = await completeSiteMutation(async () => { throw new Error("duplicate_site"); }, async () => undefined);
    expect(result).toEqual({ ok: false, phase: "save", error: expect.any(Error) });
    const feedback = siteMutationFeedback(result, "Site added.");
    expect(feedback.saved).toBe(false);
    expect(feedback.message.toLowerCase()).toContain("already has a site");
  });
});

describe("siteSaveErrorMessage", () => {
  it("maps duplicate_site to a non-disclosing workspace-name conflict", () => {
    const message = siteSaveErrorMessage(new Error("duplicate_site"));
    expect(message.toLowerCase()).toContain("already has a site");
    expect(message.toLowerCase()).toContain("name");
    expect(message).not.toMatch(/owner/i);
  });

  it("maps invalid_request to name and address limits", () => {
    const message = siteSaveErrorMessage(new Error("invalid_request"));
    expect(message).toContain("1");
    expect(message).toContain("100");
    expect(message).toContain("240");
  });

  it("maps not_found to a generic unavailable site", () => {
    expect(siteSaveErrorMessage(new Error("not_found")).toLowerCase()).toContain("no longer available");
  });

  it("maps generic and network failures to a retryable save error", () => {
    expect(siteSaveErrorMessage(new Error("request_failed")).toLowerCase()).toContain("could not save");
    expect(siteSaveErrorMessage("nope").toLowerCase()).toContain("try again");
  });
});

describe("site row actions", () => {
  it("offers edit and archive for active sites, edit and restore for archived sites", () => {
    expect(siteRowActions(true)).toEqual(["edit", "archive"]);
    expect(siteRowActions(false)).toEqual(["edit", "restore"]);
  });
});

describe("site setup presentation", () => {
  it("manages sites from GET /api/sites and keeps assignment and shift pickers on dashboard data.sites", () => {
    const helper = fs.readFileSync(path.resolve("src/lib/site-setup.ts"), "utf8");
    const component = fs.readFileSync(path.resolve("src/components/site-setup.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");

    expect(helper).toContain("readSiteList");
    expect(helper).toContain("completeSiteMutation");
    expect(helper).not.toContain("owner_user_id");
    expect(component).not.toContain("owner_user_id");
    expect(component).toContain("sitesListUrl(");
    expect(component).toContain('cache: "no-store"');
    expect(component).toContain("readSiteList");
    expect(component).toContain("completeSiteMutation");
    expect(component).toContain("siteMutationFeedback");
    expect(component).toContain("Show archived sites");
    expect(component).toContain("Try again");
    expect(component).toContain("aria-labelledby");
    expect(component).toContain("aria-describedby");
    expect(component).toContain("autoFocus");
    expect(component).toMatch(/aria-label=\{`Edit \$\{/);
    expect(component).toMatch(/aria-label=\{`Archive \$\{/);
    expect(component).toMatch(/aria-label=\{`Restore \$\{/);
    expect(component).toContain("role=\"status\"");
    expect(component).toContain("role=\"alert\"");
    expect(component).toContain("/sign-in");

    expect(dashboard).toContain("<SiteSetup");
    expect(dashboard).toContain("<ShiftEntrySheet data={data}");
    expect(dashboard).toContain("<AssignmentManager");
    expect(dashboard).toContain("data.sites");
    expect(dashboard).not.toContain("SiteForm");
    expect(dashboard).not.toMatch(/mutate\(\(\) => send\("\/api\/sites"/);
  });

  it("styles site rows, status, archive dialog, and archived toggle without colour-only status", () => {
    const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");
    expect(css).toContain(".site-status");
    expect(css).toContain(".site-row-actions");
    expect(css).toContain(".show-archived");
    expect(css).toContain(".archive-site-dialog");
    expect(css).toMatch(/\.site-row-actions[\s\S]*min-height:\s*44px/);
  });
});
