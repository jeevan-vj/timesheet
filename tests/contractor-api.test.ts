import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  user: { id: "owner-1", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));

const timesheet = vi.hoisted(() => ({
  listContractors: vi.fn(),
  createContractor: vi.fn(),
  getContractor: vi.fn(),
  updateContractor: vi.fn(),
  archiveContractor: vi.fn(),
  restoreContractor: vi.fn(),
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
vi.mock("@/services/timesheet", () => timesheet);

import { GET as listOrCreateGet, POST as createContractor } from "../src/app/api/contractors/route";
import { GET as getContractor, PATCH as patchContractor } from "../src/app/api/contractors/[id]/route";
import { POST as archiveContractor } from "../src/app/api/contractors/[id]/archive/route";
import { POST as restoreContractor } from "../src/app/api/contractors/[id]/restore/route";

const resource = {
  id: "c1",
  name: "Aroha",
  email: "a@example.test",
  phone: "",
  defaultRateCents: 3_200,
  currency: "NZD",
  active: true,
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  updatedAt: new Date("2026-08-31T00:00:00.000Z"),
};

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

function jsonRequest(url: string, method: string, body: unknown, headers: Record<string, string> = {}) {
  const encoded = JSON.stringify(body);
  return new Request(url, {
    method,
    body: encoded,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(encoded)),
      cookie: "better-auth.session_token=test",
      origin: "https://app.example.test",
      ...headers,
    },
  });
}

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

describe("contractor API", () => {
  beforeEach(() => {
    session.user = { id: "owner-1", email: "owner@example.test", name: "Owner" };
    for (const fn of Object.values(timesheet)) fn.mockReset();
  });

  it("rejects cookie mutations from an untrusted origin", async () => {
    const request = jsonRequest("https://app.example.test/api/contractors", "POST", { name: "Aroha", defaultRateCents: 3200 }, { origin: "https://evil.example" });
    const response = await createContractor(request);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(timesheet.createContractor).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated reads and mutations", async () => {
    session.user = null;
    const list = await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors"));
    expect(list.status).toBe(401);
    expect(await list.json()).toEqual({ error: "unauthorized" });

    const created = await createContractor(jsonRequest("https://app.example.test/api/contractors", "POST", { name: "Aroha", defaultRateCents: 3200 }));
    expect(created.status).toBe(401);
    expect(await created.json()).toEqual({ error: "unauthorized" });
    expect(timesheet.createContractor).not.toHaveBeenCalled();
  });

  it("derives owner from the session and ignores ownerUserId in the body", async () => {
    timesheet.createContractor.mockResolvedValue(resource);
    const response = await createContractor(jsonRequest("https://app.example.test/api/contractors", "POST", {
      name: "Aroha",
      email: "a@example.test",
      phone: "",
      defaultRateCents: 3200,
      ownerUserId: "forged-owner",
      currency: "USD",
      active: false,
      id: "forged-id",
    }));
    expect(response.status).toBe(201);
    expect(timesheet.createContractor).toHaveBeenCalledTimes(1);
    expect(timesheet.createContractor).toHaveBeenCalledWith(db, "owner-1", {
      name: "Aroha",
      email: "a@example.test",
      phone: "",
      defaultRateCents: 3200,
    });
    const body = await response.json() as { ownerUserId?: string };
    expect(body).not.toHaveProperty("ownerUserId");
  });

  it("lists contractors for the session owner and parses includeArchived", async () => {
    timesheet.listContractors.mockResolvedValue([resource]);
    const omitted = await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors"));
    expect(omitted.status).toBe(200);
    expect(await omitted.json()).toEqual({ contractors: [JSON.parse(JSON.stringify(resource))] });
    expect(timesheet.listContractors).toHaveBeenCalledWith(db, "owner-1", false);

    timesheet.listContractors.mockClear();
    await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors?includeArchived=true"));
    expect(timesheet.listContractors).toHaveBeenCalledWith(db, "owner-1", true);

    timesheet.listContractors.mockClear();
    await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors?includeArchived=1"));
    expect(timesheet.listContractors).toHaveBeenCalledWith(db, "owner-1", true);

    timesheet.listContractors.mockClear();
    await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors?includeArchived=0"));
    expect(timesheet.listContractors).toHaveBeenCalledWith(db, "owner-1", false);

    const invalid = await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors?includeArchived=yes"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
    expect(timesheet.listContractors).toHaveBeenCalledTimes(1);
  });

  it("allows GET list with a cookie even when Origin is untrusted", async () => {
    timesheet.listContractors.mockResolvedValue([]);
    const response = await listOrCreateGet(cookieRequest("https://app.example.test/api/contractors", "GET", { origin: "https://evil.example" }));
    expect(response.status).toBe(200);
  });

  it("returns field errors for invalid contractor input and not_found versus duplicate_contractor", async () => {
    const invalid = await createContractor(jsonRequest("https://app.example.test/api/contractors", "POST", { name: "", email: "bad", defaultRateCents: 100 }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "invalid_request",
      fields: {
        name: "Enter a name between 1 and 100 characters.",
        email: "Enter a valid email or leave it blank.",
        defaultRateCents: "Default hourly rate must be a whole number of cents between 1500 and 25000 (NZ$15–NZ$250).",
      },
    });
    expect(timesheet.createContractor).not.toHaveBeenCalled();

    timesheet.createContractor.mockRejectedValue(new Error("duplicate_contractor"));
    const duplicate = await createContractor(jsonRequest("https://app.example.test/api/contractors", "POST", { name: "Aroha", defaultRateCents: 3200 }));
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "duplicate_contractor" });

    timesheet.getContractor.mockRejectedValue(new Error("not_found"));
    const missing = await getContractor(cookieRequest("https://app.example.test/api/contractors/other-owner"), idParams("other-owner"));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "not_found" });
  });

  it("rejects overlong ids before any write", async () => {
    const id = "c".repeat(65);
    const get = await getContractor(cookieRequest(`https://app.example.test/api/contractors/${id}`), idParams(id));
    expect(get.status).toBe(400);
    expect(await get.json()).toEqual({ error: "invalid_request" });
    expect(timesheet.getContractor).not.toHaveBeenCalled();

    const archived = await archiveContractor(cookieRequest(`https://app.example.test/api/contractors/${id}/archive`, "POST"), idParams(id));
    expect(archived.status).toBe(400);
    expect(timesheet.archiveContractor).not.toHaveBeenCalled();
  });

  it("patches the contractor from session-scoped input, including empty email and phone", async () => {
    timesheet.updateContractor.mockResolvedValue({ ...resource, email: "", phone: "", defaultRateCents: 4_000 });
    const response = await patchContractor(jsonRequest("https://app.example.test/api/contractors/c1", "PATCH", {
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 4000,
      ownerUserId: "forged-owner",
      active: false,
    }), idParams("c1"));
    expect(response.status).toBe(200);
    expect(timesheet.updateContractor).toHaveBeenCalledWith(db, "owner-1", "c1", {
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 4000,
    });
  });

  it("archives and restores without reading a JSON body", async () => {
    timesheet.archiveContractor.mockResolvedValue({ ...resource, active: false });
    timesheet.restoreContractor.mockResolvedValue({ ...resource, active: true });
    const archived = await archiveContractor(cookieRequest("https://app.example.test/api/contractors/c1/archive", "POST"), idParams("c1"));
    expect(archived.status).toBe(200);
    expect(await archived.json()).toMatchObject({ id: "c1", active: false });
    expect(timesheet.archiveContractor).toHaveBeenCalledWith(db, "owner-1", "c1");

    const restored = await restoreContractor(cookieRequest("https://app.example.test/api/contractors/c1/restore", "POST"), idParams("c1"));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ id: "c1", active: true });
    expect(timesheet.restoreContractor).toHaveBeenCalledWith(db, "owner-1", "c1");
  });

  it("returns not_found for cross-owner archive and restore without writing", async () => {
    timesheet.archiveContractor.mockRejectedValue(new Error("not_found"));
    timesheet.restoreContractor.mockRejectedValue(new Error("not_found"));
    const archived = await archiveContractor(cookieRequest("https://app.example.test/api/contractors/c9/archive", "POST"), idParams("c9"));
    expect(archived.status).toBe(404);
    expect(await archived.json()).toEqual({ error: "not_found" });
    const restored = await restoreContractor(cookieRequest("https://app.example.test/api/contractors/c9/restore", "POST"), idParams("c9"));
    expect(restored.status).toBe(404);
    expect(await restored.json()).toEqual({ error: "not_found" });
  });

  it("rejects malformed JSON on create without disclosing the body", async () => {
    const response = await createContractor(new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body: "{not-json",
      headers: {
        "content-type": "application/json",
        "content-length": "9",
        cookie: "better-auth.session_token=test",
        origin: "https://app.example.test",
      },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
