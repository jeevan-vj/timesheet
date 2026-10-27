import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLEANTRACK_APP_SCHEME,
  CLEANTRACK_PREVIEW_SCHEME,
  MOBILE_CLIENT_HEADER,
  isTrustedMutationRequest,
  trustedOriginsFor,
} from "../src/lib/accounts-config";

const session = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));

const timesheet = vi.hoisted(() => ({
  createContractor: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
  },
}));
vi.mock("@/db/client", () => ({ db: { tag: "mock-db" } }));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async () => session.user,
}));
vi.mock("@/lib/runtime-env", () => ({
  getTrustedOrigins: () => ["https://app.example.test", CLEANTRACK_APP_SCHEME],
  getSecureCookies: () => true,
}));
vi.mock("@/services/timesheet", () => timesheet);

import { POST as createContractor } from "../src/app/api/contractors/route";

const TRUSTED = ["https://app.example.test", CLEANTRACK_APP_SCHEME];
const PRODUCTION = "https://cleantrack-timesheet.jeevan90wijerathna.workers.dev";
const PREVIEW = "https://cleantrack-timesheet-preview.example.workers.dev";

function mutation(headers: Record<string, string>) {
  return new Request("https://app.example.test/api/contractors", { method: "POST", headers });
}

function cookieMutation(headers: Record<string, string> = {}) {
  return mutation({ cookie: "better-auth.session_token=test", ...headers });
}

describe("native mutation guard", () => {
  beforeEach(() => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    timesheet.createContractor.mockReset();
    timesheet.createContractor.mockResolvedValue({
      id: "c1",
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3200,
      currency: "NZD",
      active: true,
      createdAt: new Date("2026-08-31T00:00:00.000Z"),
      updatedAt: new Date("2026-08-31T00:00:00.000Z"),
    });
  });

  it("rejects a browser cross-site cookie mutation", () => {
    const request = cookieMutation({ origin: "https://evil.example", [MOBILE_CLIENT_HEADER]: "mobile/1.0.0" });
    expect(isTrustedMutationRequest(request, TRUSTED)).toBe(false);
  });

  it("allows a same-origin cookie mutation without the mobile header", () => {
    const request = cookieMutation({ origin: "https://app.example.test" });
    expect(isTrustedMutationRequest(request, TRUSTED)).toBe(true);
  });

  it("rejects a cookie mutation with no Origin and no mobile header", () => {
    expect(isTrustedMutationRequest(cookieMutation(), TRUSTED)).toBe(false);
  });

  it("allows a cookie mutation with no Origin and a mobile client header", () => {
    const request = cookieMutation({ [MOBILE_CLIENT_HEADER]: "mobile/1.0.0" });
    expect(isTrustedMutationRequest(request, TRUSTED)).toBe(true);
  });

  it("rejects an Origin of null even when the mobile header is present", () => {
    const request = cookieMutation({ origin: "null", [MOBILE_CLIENT_HEADER]: "mobile/1" });
    expect(isTrustedMutationRequest(request, TRUSTED)).toBe(false);
  });

  it("rejects a mobile header that is not mobile/version", () => {
    for (const value of ["mobile", "mobile/", "Mobile/1", "browser/1", "mobile/1 0", "mobile/" + "1".repeat(40)]) {
      expect(isTrustedMutationRequest(cookieMutation({ [MOBILE_CLIENT_HEADER]: value }), TRUSTED)).toBe(false);
    }
    const headers = new Headers({ cookie: "better-auth.session_token=test" });
    headers.append(MOBILE_CLIENT_HEADER, "mobile/1");
    headers.append(MOBILE_CLIENT_HEADER, "mobile/2");
    expect(isTrustedMutationRequest(new Request("https://app.example.test/api/contractors", { method: "POST", headers }), TRUSTED)).toBe(false);
  });

  it("returns 403, 401, and no CORS allowance from the contractor route", async () => {
    const body = JSON.stringify({ name: "Aroha", defaultRateCents: 3200 });
    const jsonHeaders = {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      cookie: "better-auth.session_token=test",
    };
    const crossSite = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body,
      headers: { ...jsonHeaders, origin: "https://evil.example" },
    }));
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("access-control-allow-origin")).toBeNull();
    expect(await crossSite.json()).toEqual({ error: "forbidden" });

    const sameOrigin = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body,
      headers: { ...jsonHeaders, origin: "https://app.example.test" },
    }));
    expect(sameOrigin.status).toBe(201);
    expect(sameOrigin.headers.get("access-control-allow-origin")).toBeNull();

    const missing = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body,
      headers: jsonHeaders,
    }));
    expect(missing.status).toBe(403);

    const mobile = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body,
      headers: { ...jsonHeaders, [MOBILE_CLIENT_HEADER]: "mobile/58.0.19" },
    }));
    expect(mobile.status).toBe(201);
    expect(mobile.headers.get("access-control-allow-origin")).toBeNull();

    session.user = null;
    const anonymous = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body,
      headers: { ...jsonHeaders, [MOBILE_CLIENT_HEADER]: "mobile/1.0.0" },
    }));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
    expect(timesheet.createContractor).toHaveBeenCalledTimes(2);
  });
});

describe("app scheme trusted origins", () => {
  it("trusts cleantrack:// on production and does not trust exp or preview schemes", () => {
    const origins = trustedOriginsFor(PRODUCTION, "cleantrack://, not a url");
    expect(origins).toEqual([PRODUCTION, CLEANTRACK_APP_SCHEME]);
    expect(origins).not.toContain("null");
    expect(origins).not.toContain(CLEANTRACK_PREVIEW_SCHEME);
    expect(origins.some((origin) => origin.startsWith("exp://"))).toBe(false);
  });

  it("adds the preview scheme only for a preview host", () => {
    expect(trustedOriginsFor(PREVIEW)).toEqual([PREVIEW, CLEANTRACK_APP_SCHEME, CLEANTRACK_PREVIEW_SCHEME]);
  });

  it("adds preview and exp schemes only for loopback HTTP", () => {
    const origins = trustedOriginsFor("http://127.0.0.1:8787", "http://localhost:3000");
    expect(origins).toEqual([
      "http://127.0.0.1:8787",
      "http://localhost:3000",
      CLEANTRACK_APP_SCHEME,
      CLEANTRACK_PREVIEW_SCHEME,
      "exp://",
      "exp://**",
      "exp://192.168.*.*:*/**",
    ]);
    expect(trustedOriginsFor("https://localhost:8787")).toEqual(["https://localhost:8787", CLEANTRACK_APP_SCHEME]);
  });
});
