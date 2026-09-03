import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { remittanceFilename } from "../src/lib/remittance";
import {
  cancelRemittanceDownload,
  createRemittanceDownloadFlow,
  idleRemittanceDownload,
  parseContentDispositionFilename,
  remittanceDownloadFilename,
  remittanceDownloadPrompt,
  remittanceDownloadRequest,
  remittanceDownloadUrl,
  remittanceErrorMessage,
  requestRemittanceDownload,
} from "../src/lib/remittance-download";

const target = {
  contractorId: "c1",
  contractorName: "Aroha",
  weekStart: "2026-08-31",
  weekEnd: "2026-09-06",
};

describe("remittance download confirmation", () => {
  it("builds a GET url from contractor id and week without owner_user_id", () => {
    const url = remittanceDownloadUrl(target);
    const request = remittanceDownloadRequest(target);

    expect(url).toBe("/api/contractors/c1/remittance?week=2026-08-31");
    expect(request).toEqual({ method: "GET", url });
    expect(url).not.toContain("owner_user_id");
    expect(JSON.stringify(request)).not.toContain("owner_user_id");
  });

  it("identifies the contractor and week bounds before any download", () => {
    const session = requestRemittanceDownload(target);
    const prompt = remittanceDownloadPrompt(session.target, "31 Aug – 6 Sep");

    expect(session).toEqual({ phase: "confirming", target });
    expect(prompt.title).toBe("Download remittance?");
    expect(prompt.description).toContain("Aroha");
    expect(prompt.description).toContain("31 Aug");
    expect(prompt.description).toContain("6 Sep");
    expect(prompt.confirmLabel).toBe("Download remittance");
    expect(prompt.cancelLabel).toBe("Cancel");
    expect(prompt.closeLabel).toBe("Close remittance confirmation");
  });

  it("cancel and close return to idle without downloading", async () => {
    const download = vi.fn();
    const flow = createRemittanceDownloadFlow(download);
    flow.request(target);
    flow.cancel();
    await flow.confirm();

    expect(flow.getSession()).toEqual(idleRemittanceDownload);
    expect(cancelRemittanceDownload()).toEqual(idleRemittanceDownload);
    expect(download).not.toHaveBeenCalled();
  });

  it("confirm calls download once with the GET url", async () => {
    const download = vi.fn(async () => undefined);
    const flow = createRemittanceDownloadFlow(download);
    flow.request(target);

    await flow.confirm();

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith({
      method: "GET",
      url: "/api/contractors/c1/remittance?week=2026-08-31",
    });
    expect(flow.getSession()).toEqual(idleRemittanceDownload);
  });

  it("ignores a second confirm while the first download is in flight", async () => {
    let finish!: () => void;
    const download = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const flow = createRemittanceDownloadFlow(download);
    flow.request(target);

    const first = flow.confirm();
    expect(flow.getSession().phase).toBe("submitting");
    const second = flow.confirm();
    flow.cancel();
    finish();
    await Promise.all([first, second]);

    expect(download).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleRemittanceDownload);
  });

  it("closes after a failed download so existing error messaging can surface", async () => {
    const download = vi.fn(async () => { throw new Error("no_entries"); });
    const flow = createRemittanceDownloadFlow(download);
    flow.request(target);

    await expect(flow.confirm()).rejects.toThrow("no_entries");
    expect(download).toHaveBeenCalledTimes(1);
    expect(flow.getSession()).toEqual(idleRemittanceDownload);
  });
});

describe("remittanceErrorMessage", () => {
  it("maps API error codes to useful notices", () => {
    expect(remittanceErrorMessage("no_entries")).toMatch(/no shifts for that contractor this week/i);
    expect(remittanceErrorMessage("not_found")).toMatch(/could not find that contractor/i);
    expect(remittanceErrorMessage("not_found")).toMatch(/refresh/i);
    expect(remittanceErrorMessage("invalid_week")).toMatch(/week is invalid/i);
    expect(remittanceErrorMessage("missing_remitter")).toMatch(/account name/i);
    expect(remittanceErrorMessage("missing_remitter")).toMatch(/email/i);
    expect(remittanceErrorMessage("request_failed")).toMatch(/cannot generate remittance/i);
    expect(remittanceErrorMessage("unauthorized")).toMatch(/cannot generate remittance/i);
  });
});

describe("parseContentDispositionFilename", () => {
  it("reads the quoted attachment filename", () => {
    expect(parseContentDispositionFilename('attachment; filename="remittance-aroha-2026-09-06.pdf"'))
      .toBe("remittance-aroha-2026-09-06.pdf");
  });

  it("returns null when the header is missing", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });

  it("falls back to remittanceFilename when Content-Disposition is missing", () => {
    expect(remittanceDownloadFilename(null, target)).toBe(remittanceFilename(target.contractorName, target.weekEnd));
    expect(remittanceDownloadFilename('attachment; filename="remittance-aroha-2026-09-06.pdf"', target))
      .toBe("remittance-aroha-2026-09-06.pdf");
  });
});

describe("weekly dashboard remittance controls", () => {
  const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");

  it("adds a remittance control on summary rows and a confirmation dialog", () => {
    expect(dashboard).toContain("Remittance");
    expect(dashboard).toContain("Download remittance for ${row.contractorName}");
    expect(dashboard).toContain("RemittanceDownloadDialog");
    expect(dashboard).toContain("createRemittanceDownloadFlow");
    expect(dashboard).toContain('cache: "no-store"');
    expect(dashboard).toContain("remittanceDownloadFilename");
    expect(dashboard).not.toContain('from "@/lib/remittance"');
    expect(dashboard).toContain("window.location.assign(\"/sign-in\")");
    expect(dashboard).not.toContain("owner_user_id");
  });

  it("keeps empty-week copy and does not show a remittance CTA without summary rows", () => {
    expect(dashboard).toContain('title="No shifts this week"');
    expect(dashboard).toContain("Payment totals appear as shifts are added.");
    expect(dashboard).toMatch(/data\.summary\.length \?[\s\S]*Remittance[\s\S]*: <p className="muted roomy">Payment totals appear as shifts are added\.<\/p>/);
  });

  it("keeps remittance available on approved weeks", () => {
    expect(dashboard).toContain("WeekApprovalBar");
    expect(dashboard).toContain("weekLocked");
    expect(dashboard).toMatch(/aria-label={`Download remittance for \$\{row\.contractorName\}`}/);
    expect(dashboard).not.toMatch(/disabled=\{weekLocked\}[\s\S]*Download remittance for/);
  });
});
