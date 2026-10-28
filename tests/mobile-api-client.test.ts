import { describe, expect, it } from "vitest";
import { MOBILE_CLIENT_HEADER as SERVER_CLIENT_HEADER } from "../src/lib/accounts-config";
import {
  MOBILE_CLIENT_HEADER,
  PRODUCTION_API_URL,
  buildApiRequest,
  mobileClientValue,
  resolveApiBaseUrl,
  roleLabel,
  sessionEndsOnStatus,
  signInErrorMessage,
  viewerRole,
} from "../apps/mobile/src/api-config";
import { readViewerProfile, readViewerRole } from "../apps/mobile/src/me-response";

const COOKIE = "better-auth.session_token=session-value";

describe("mobile API base URL", () => {
  it("uses the production Worker when no URL is configured", () => {
    expect(resolveApiBaseUrl()).toBe(PRODUCTION_API_URL);
    expect(resolveApiBaseUrl({ publicUrl: "  ", extraUrl: "" })).toBe(PRODUCTION_API_URL);
  });

  it("prefers EXPO_PUBLIC_API_URL, then app config extra", () => {
    expect(resolveApiBaseUrl({
      publicUrl: "http://127.0.0.1:3000/",
      extraUrl: "https://extra.example.test",
    })).toBe("http://127.0.0.1:3000");
    expect(resolveApiBaseUrl({
      publicUrl: "not a url",
      extraUrl: "https://extra.example.test/app/",
    })).toBe("https://extra.example.test/app");
  });

  it("drops credentials, queries, and non-http URLs", () => {
    expect(resolveApiBaseUrl({ publicUrl: "https://user:secret@example.test/api?token=1#frag" })).toBe(PRODUCTION_API_URL);
    expect(resolveApiBaseUrl({ publicUrl: "javascript:alert(1)", extraUrl: "cleantrack://" })).toBe(PRODUCTION_API_URL);
  });
});

describe("mobile client header", () => {
  it("matches the server header name and version shape", () => {
    expect(MOBILE_CLIENT_HEADER.toLowerCase()).toBe(SERVER_CLIENT_HEADER);
    expect(mobileClientValue("0.1.0")).toBe("mobile/0.1.0");
    expect(mobileClientValue("58.0.19")).toBe("mobile/58.0.19");
    expect(mobileClientValue("")).toBe("mobile/0");
    expect(mobileClientValue("1 0")).toBe("mobile/0");
    expect(mobileClientValue("a".repeat(40))).toBe("mobile/0");
  });

  it("sends the header and session cookie on native requests and omits credentials", () => {
    const request = buildApiRequest({
      baseUrl: "https://api.example.test/",
      path: "/api/me",
      version: "0.1.0",
      cookie: `  ${COOKIE}  `,
      headers: { accept: "application/json", [MOBILE_CLIENT_HEADER]: "mobile/spoofed" },
    });
    const headers = new Headers(request.headers);
    expect(request.url).toBe("https://api.example.test/api/me");
    expect(request.url).not.toContain(COOKIE);
    expect(request.credentials).toBe("omit");
    expect(headers.get(MOBILE_CLIENT_HEADER)).toBe("mobile/0.1.0");
    expect(headers.get("cookie")).toBe(COOKIE);
    expect(headers.get("accept")).toBe("application/json");
  });

  it("keeps the client header on web fetches and lets the browser send the cookie", () => {
    const request = buildApiRequest({
      baseUrl: PRODUCTION_API_URL,
      path: "/api/health",
      version: "0.1.0",
      cookie: COOKIE,
      headers: { cookie: COOKIE },
      transport: "web",
    });
    const headers = new Headers(request.headers);
    expect(request.credentials).toBe("include");
    expect(headers.get(MOBILE_CLIENT_HEADER)).toBe("mobile/0.1.0");
    expect(headers.get("cookie")).toBeNull();
  });

  it("refuses a path that is not an app-relative URL", () => {
    expect(() => buildApiRequest({
      baseUrl: "ftp://example.test",
      path: "/api/me",
      version: "0.1.0",
    })).toThrow("invalid_api_base");
    expect(() => buildApiRequest({
      baseUrl: PRODUCTION_API_URL,
      path: "https://evil.example/api/me",
      version: "0.1.0",
    })).toThrow("invalid_api_path");
  });
});

describe("viewer role from /api/me", () => {
  const link = { businessId: "biz_1", businessName: "Northwind" };

  it("derives contractor, owner, both, or none", () => {
    expect(viewerRole({ owner: null, contractorOf: [link] })).toBe("contractor");
    expect(viewerRole({ owner: { id: "biz_1" }, contractorOf: [] })).toBe("owner");
    expect(viewerRole({ owner: { id: "biz_1" }, contractorOf: [link] })).toBe("owner_and_contractor");
    expect(viewerRole({ owner: null, contractorOf: [] })).toBe("none");
    expect(roleLabel("contractor")).toBe("Contractor");
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("owner_and_contractor")).toBe("Owner and contractor");
    expect(roleLabel("none")).toBe("No workspace yet");
  });

  it("reads a role only from a well-formed /api/me body", () => {
    expect(readViewerProfile({ owner: null, contractorOf: [link], extra: true })).toEqual({
      role: "contractor",
      contractorOf: [link],
    });
    expect(readViewerRole({ owner: null, contractorOf: [link], extra: true })).toBe("contractor");
    expect(readViewerRole({ owner: { name: "Northwind" }, contractorOf: [] })).toBe("owner");
    expect(readViewerRole({ owner: null })).toBeNull();
    expect(readViewerRole({ owner: null, contractorOf: [{ businessId: "biz_1" }] })).toBeNull();
    expect(readViewerRole(null)).toBeNull();
  });
});

describe("sign-in outcomes", () => {
  it("maps offline, rate limit, and rejected credentials", () => {
    expect(signInErrorMessage({ offline: true })).toMatch(/connection/i);
    expect(signInErrorMessage({ status: 429 })).toMatch(/too many attempts/i);
    expect(signInErrorMessage({ status: 401 })).toMatch(/email or password/i);
  });

  it("ends the stored session only on 401", () => {
    expect(sessionEndsOnStatus(401)).toBe(true);
    expect(sessionEndsOnStatus(403)).toBe(false);
    expect(sessionEndsOnStatus(200)).toBe(false);
  });
});
