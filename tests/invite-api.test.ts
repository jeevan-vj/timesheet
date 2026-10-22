import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ user: { id: "owner-1", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null }));
const workerEnv = vi.hoisted(() => ({ DB: {}, BETTER_AUTH_URL: "https://app.example.test", AUTH_TRUSTED_ORIGINS: "", BETTER_AUTH_SECRET: "test", RELEASE_SHA: "test-release", SENTRY_DSN: undefined as string | undefined }));
const invites = vi.hoisted(() => ({ createInvite: vi.fn(), resendInvite: vi.fn(), revokeInvite: vi.fn(), listInvites: vi.fn(), inspectInvite: vi.fn(), acceptInvite: vi.fn() }));
const delivery = vi.hoisted(() => ({ assertEmailConfigured: vi.fn(), deliverInvite: vi.fn() }));
const auth = vi.hoisted(() => ({ api: { signUpEmail: vi.fn() } }));
const db = vi.hoisted(() => ({ tag: "db" }));

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
vi.mock("@/db/client", () => ({ db }));
vi.mock("@/lib/auth", () => ({ auth }));
vi.mock("@/lib/request-session", () => ({ requireSessionUser: async () => session.user }));
vi.mock("@/lib/runtime-env", () => ({ getTrustedOrigins: () => ["https://app.example.test"], getSecureCookies: () => true }));
vi.mock("@/services/invites", () => invites);
vi.mock("@/lib/invite-delivery", () => delivery);

import { POST as create } from "../src/app/api/contractors/[id]/invite/route";
import { POST as resend } from "../src/app/api/contractor-invites/[id]/resend/route";
import { POST as revoke } from "../src/app/api/contractor-invites/[id]/revoke/route";
import { GET as inspect, POST as accept } from "../src/app/api/invites/[token]/route";
import { POST as signup } from "../src/app/api/invites/[token]/signup/route";

const request = (url: string, method = "POST") => new Request(url, { method, headers: { cookie: "better-auth.session_token=test", origin: "https://app.example.test" } });
const params = (value: string, key: "id" | "token") => ({ params: Promise.resolve({ [key]: value }) } as never);
const deliveryResult = { id: "invite-1", contractorId: "c1", status: "pending", expiresAt: "2026-10-29T00:00:00.000Z", rawToken: "raw", invitedEmail: "sam@example.test", businessName: "Synthetic Cleaning" };

describe("invite API", () => {
  beforeEach(() => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    workerEnv.SENTRY_DSN = undefined;
    for (const fn of [...Object.values(invites), ...Object.values(delivery), auth.api.signUpEmail]) fn.mockReset();
  });

  it("derives the owner from the session and sends without returning the raw token", async () => {
    invites.createInvite.mockResolvedValue(deliveryResult);
    const response = await create(request("https://app.example.test/api/contractors/c1/invite"), params("c1", "id"));
    expect(response.status).toBe(201);
    expect(invites.createInvite).toHaveBeenCalledWith(db, "owner-1", "c1");
    expect(delivery.deliverInvite).toHaveBeenCalledWith(deliveryResult);
    expect(await response.text()).not.toContain("raw");
  });

  it("preflights all email configuration before creating an invitation", async () => {
    delivery.assertEmailConfigured.mockImplementation(() => { throw new Error("email_not_configured"); });
    const response = await create(request("https://app.example.test/api/contractors/c1/invite"), params("c1", "id"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "email_not_configured" });
    expect(invites.createInvite).not.toHaveBeenCalled();
    expect(delivery.deliverInvite).not.toHaveBeenCalled();
  });

  it("returns the same not_found response for cross-business invite ids", async () => {
    invites.resendInvite.mockRejectedValue(new Error("not_found")); invites.revokeInvite.mockRejectedValue(new Error("not_found"));
    for (const route of [resend, revoke]) {
      const response = await route(request("https://app.example.test/api/contractor-invites/other/revoke"), params("other", "id"));
      expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("uses generic unavailable responses for invalid, expired, revoked and replayed tokens", async () => {
    invites.inspectInvite.mockRejectedValue(new Error("invite_unavailable"));
    const response = await inspect(request("https://app.example.test/api/invites/unknown", "GET"), params("unknown", "token"));
    expect(response.status).toBe(404); expect(await response.json()).toEqual({ error: "invite_unavailable" });
  });

  it("redacts a raw invitation token from unexpected route errors and reporter output", async () => {
    const token = "A".repeat(43);
    workerEnv.SENTRY_DSN = "https://public-key@example.test/42";
    const failure = new Error(`failed at /api/invites/${token}/signup`);
    failure.name = `RouteError /invite/${token}`;
    invites.inspectInvite.mockRejectedValue(failure);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    try {
      const response = await inspect(request(`https://app.example.test/api/invites/${token}`, "GET"), params(token, "token"));
      expect(response.status).toBe(500);
      expect(errorSpy).toHaveBeenCalledOnce();
      const output = `${String(errorSpy.mock.calls[0]?.[0])}\n${String(fetchSpy.mock.calls[0]?.[0])}\n${String(fetchSpy.mock.calls[0]?.[1]?.body)}`;
      expect(output).not.toContain(token);
      expect(output).toContain("/api/invites/[token]");
    } finally {
      errorSpy.mockRestore();
      fetchSpy.mockRestore();
    }
  });

  it("accepts only as the authenticated user and never takes an identity from the client", async () => {
    const response = await accept(request("https://app.example.test/api/invites/token"), params("token", "token"));
    expect(response.status).toBe(200);
    expect(invites.acceptInvite).toHaveBeenCalledWith(db, "token", session.user);
  });

  it("requires authentication and trusted origin for acceptance", async () => {
    session.user = null;
    const anonymous = await accept(request("https://app.example.test/api/invites/token"), params("token", "token"));
    expect(anonymous.status).toBe(401);
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    const forbidden = await accept(new Request("https://app.example.test/api/invites/token", { method: "POST", headers: { cookie: "x", origin: "https://evil.example" } }), params("token", "token"));
    expect(forbidden.status).toBe(403);
  });

  it("derives invite sign-up email on the server and forwards only the session cookie", async () => {
    invites.inspectInvite.mockResolvedValue({ invitedEmail: "locked@example.test", businessName: "Synthetic Cleaning", expiresAt: "2026-10-29T00:00:00.000Z" });
    auth.api.signUpEmail.mockResolvedValue({
      headers: new Headers({ "set-cookie": "better-auth.session_token=synthetic; Path=/; HttpOnly" }),
      response: { token: "must-not-be-returned", user: { id: "user-1" } },
    });
    const token = "B".repeat(43);
    const body = JSON.stringify({ name: "Synthetic Contractor", email: "attacker@example.test", password: "Synthetic-password-46" });
    const response = await signup(new Request(`https://app.example.test/api/invites/${token}/signup`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), origin: "https://app.example.test" },
    }), params(token, "token"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ created: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("better-auth.session_token=synthetic");
    expect(auth.api.signUpEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: { name: "Synthetic Contractor", email: "locked@example.test", password: "Synthetic-password-46" },
      returnHeaders: true,
    }));
    expect(JSON.stringify(auth.api.signUpEmail.mock.calls[0])).not.toContain("attacker@example.test");
  });

  it("returns a generic sign-up failure without exposing account existence", async () => {
    invites.inspectInvite.mockResolvedValue({ invitedEmail: "locked@example.test", businessName: "Synthetic Cleaning", expiresAt: "2026-10-29T00:00:00.000Z" });
    auth.api.signUpEmail.mockRejectedValue(new Error("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"));
    const body = JSON.stringify({ name: "Synthetic Contractor", password: "Synthetic-password-46" });
    const response = await signup(new Request(`https://app.example.test/api/invites/${"C".repeat(43)}/signup`, {
      method: "POST",
      body,
      headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)), origin: "https://app.example.test" },
    }), params("C".repeat(43), "token"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "signup_unavailable" });
  });

  it("serves every invite API response with no-store", async () => {
    invites.inspectInvite.mockResolvedValue({ invitedEmail: "locked@example.test", businessName: "Synthetic Cleaning", expiresAt: "2026-10-29T00:00:00.000Z" });
    expect((await inspect(request("https://app.example.test/api/invites/token", "GET"), params("token", "token"))).headers.get("Cache-Control")).toBe("no-store");
    expect((await accept(request("https://app.example.test/api/invites/token"), params("token", "token"))).headers.get("Cache-Control")).toBe("no-store");
  });
});
