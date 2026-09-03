import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));

const remittanceService = vi.hoisted(() => ({
  getContractorWeekRemittance: vi.fn(),
}));

const pdfRender = vi.hoisted(() => ({
  renderRemittancePdf: vi.fn(),
}));

const db = vi.hoisted(() => ({ tag: "mock-db" }));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
  },
}));
vi.mock("@/db/client", () => ({ db }));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async () => session.user,
}));
vi.mock("@/lib/runtime-env", () => ({
  getTrustedOrigins: () => ["https://app.example.test"],
  getSecureCookies: () => true,
}));
vi.mock("@/services/remittance", () => remittanceService);
vi.mock("@/lib/remittance", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/remittance")>();
  return {
    ...actual,
    renderRemittancePdf: (...args: Parameters<typeof actual.renderRemittancePdf>) => pdfRender.renderRemittancePdf(...args),
  };
});

import { GET } from "../src/app/api/contractors/[id]/remittance/route";

const weekStart = "2026-08-31";
const weekEnd = "2026-09-06";
const payload = {
  contractor: { id: "c1", name: "Aroha" },
  weekStart,
  weekEnd,
  entries: [
    {
      id: "e1",
      workDate: weekStart,
      siteName: "Harbour Offices",
      paidMinutes: 480,
      rateCents: 3_200,
      contractorId: "c1",
      contractorName: "Aroha",
    },
    {
      id: "e2",
      workDate: "2026-09-01",
      siteName: "Warehouse",
      paidMinutes: 90,
      rateCents: 2_800,
      contractorId: "c1",
      contractorName: "Aroha",
    },
  ],
};

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function cookieRequest(url: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: "better-auth.session_token=test",
      origin: "https://app.example.test",
      ...headers,
    },
  });
}

function remittanceUrl(id: string, week = weekStart) {
  return `https://app.example.test/api/contractors/${id}/remittance?week=${week}`;
}

async function expectJsonError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Type")).toMatch(/application\/json/);
  expect(response.headers.get("Content-Type")).not.toMatch(/pdf/);
  expect(await response.json()).toEqual({ error });
}

describe("contractor remittance route", () => {
  beforeEach(() => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    remittanceService.getContractorWeekRemittance.mockReset();
    pdfRender.renderRemittancePdf.mockReset();
    pdfRender.renderRemittancePdf.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34]));
  });

  it("rejects unauthenticated reads without calling the renderer", async () => {
    session.user = null;
    const response = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    await expectJsonError(response, 401, "unauthorized");
    expect(remittanceService.getContractorWeekRemittance).not.toHaveBeenCalled();
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });

  it("authorizes GET as a cookie read without mutation CSRF", async () => {
    remittanceService.getContractorWeekRemittance.mockResolvedValue(payload);
    const source = fs.readFileSync(path.resolve("src/app/api/contractors/[id]/remittance/route.ts"), "utf8");
    expect(source).toMatch(/authorize\(request\)/);
    expect(source).not.toMatch(/authorize\(request,\s*true\)/);

    const response = await GET(cookieRequest(remittanceUrl("c1"), "GET", { origin: "https://evil.example" }), idParams("c1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(remittanceService.getContractorWeekRemittance).toHaveBeenCalledWith(db, "owner-1", "c1", weekStart);
  });

  it("returns an owner PDF with download headers", async () => {
    remittanceService.getContractorWeekRemittance.mockResolvedValue(payload);
    const response = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="remittance-aroha-2026-09-06.pdf"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const body = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(body.subarray(0, 4)).toString("utf8")).toBe("%PDF");
    expect(pdfRender.renderRemittancePdf).toHaveBeenCalledTimes(1);
  });

  it("returns not_found for another owner's contractor id without a PDF", async () => {
    session.user = { id: "owner-b", email: "b@example.test", name: "Owner B" };
    remittanceService.getContractorWeekRemittance.mockRejectedValue(new Error("not_found"));
    const response = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    await expectJsonError(response, 404, "not_found");
    expect(remittanceService.getContractorWeekRemittance).toHaveBeenCalledWith(db, "owner-b", "c1", weekStart);
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });

  it("rejects a Tuesday week as invalid_week", async () => {
    const response = await GET(cookieRequest(remittanceUrl("c1", "2026-09-01")), idParams("c1"));
    await expectJsonError(response, 400, "invalid_week");
    expect(remittanceService.getContractorWeekRemittance).not.toHaveBeenCalled();
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });

  it("returns no_entries as JSON when the week has no rows", async () => {
    remittanceService.getContractorWeekRemittance.mockRejectedValue(new Error("no_entries"));
    const response = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    await expectJsonError(response, 400, "no_entries");
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });

  it("rejects an invalid contractor id before loading remittance", async () => {
    const id = "c".repeat(65);
    const response = await GET(cookieRequest(remittanceUrl(id)), idParams(id));
    await expectJsonError(response, 400, "invalid_request");
    expect(remittanceService.getContractorWeekRemittance).not.toHaveBeenCalled();
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });

  it("returns missing_remitter when the session name or email is blank", async () => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "   " };
    remittanceService.getContractorWeekRemittance.mockResolvedValue(payload);
    const unnamed = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    await expectJsonError(unnamed, 400, "missing_remitter");
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();

    session.user = { id: "owner-1", email: "  ", name: "Owner" };
    const noEmail = await GET(cookieRequest(remittanceUrl("c1")), idParams("c1"));
    await expectJsonError(noEmail, 400, "missing_remitter");
    expect(pdfRender.renderRemittancePdf).not.toHaveBeenCalled();
  });
});
