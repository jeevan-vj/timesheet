import { beforeEach, describe, expect, it, vi } from "vitest";

const { authorize, readJson, createSite, listSites, getSite, updateSite, archiveSite, restoreSite } = vi.hoisted(() => ({
  authorize: vi.fn(),
  readJson: vi.fn(),
  createSite: vi.fn(),
  listSites: vi.fn(),
  getSite: vi.fn(),
  updateSite: vi.fn(),
  archiveSite: vi.fn(),
  restoreSite: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: { DB: {}, BETTER_AUTH_URL: "http://localhost:3000" } }));
vi.mock("@/db/client", () => ({ db: { tag: "db" } }));
vi.mock("@/lib/api", () => ({
  authorize,
  readJson,
  apiError(error: unknown) {
    if (error instanceof Error && error.message === "payload_too_large") {
      return Response.json({ error: "payload_too_large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "invalid_request" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  },
}));
vi.mock("@/services/sites", () => ({
  createSite,
  listSites,
  getSite,
  updateSite,
  archiveSite,
  restoreSite,
}));

import { GET as GET_COLLECTION, POST as POST_COLLECTION } from "../src/app/api/sites/route";
import { DELETE, GET as GET_ONE, PATCH } from "../src/app/api/sites/[id]/route";
import { POST as RESTORE } from "../src/app/api/sites/[id]/restore/route";

const user = { id: "owner-a", email: "owner@example.test", name: "Owner" };
const site = {
  id: "site-1",
  name: "Harbour Offices",
  address: "1 Quay St",
  active: true,
  updatedAt: new Date("2026-08-31T00:00:00.000Z"),
};

function jsonRequest(url: string, init?: RequestInit) {
  return new Request(url, init);
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

function authed() {
  authorize.mockResolvedValue({ user });
}

function unauthorized() {
  authorize.mockImplementation(async () => ({ response: Response.json({ error: "unauthorized" }, { status: 401 }) }));
}

function forbiddenOnMutation() {
  authorize.mockImplementation(async (_request: Request, mutation = false) => {
    if (mutation) return { response: Response.json({ error: "forbidden" }, { status: 403 }) };
    return { user };
  });
}

async function body(response: Response) {
  return { status: response.status, json: await response.json(), cache: response.headers.get("Cache-Control") };
}

describe("site routes", () => {
  beforeEach(() => {
    authorize.mockReset();
    readJson.mockReset();
    createSite.mockReset();
    listSites.mockReset();
    getSite.mockReset();
    updateSite.mockReset();
    archiveSite.mockReset();
    restoreSite.mockReset();
  });

  it("authorizes collection GET as a read and mutations as trusted-origin writes", async () => {
    authed();
    listSites.mockResolvedValue([site]);
    createSite.mockResolvedValue(site);
    readJson.mockResolvedValue({ name: "Harbour Offices", address: "1 Quay St" });

    await GET_COLLECTION(jsonRequest("http://localhost/api/sites"));
    expect(authorize.mock.calls[0]?.[1]).toBeUndefined();

    await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" }));
    expect(authorize.mock.calls[1]?.[1]).toBe(true);
  });

  it("authorizes item GET as a read and PATCH/DELETE/restore as mutations", async () => {
    authed();
    getSite.mockResolvedValue(site);
    updateSite.mockResolvedValue(site);
    archiveSite.mockResolvedValue({ ...site, active: false });
    restoreSite.mockResolvedValue(site);
    readJson.mockResolvedValue({ name: "Harbour Offices", address: "1 Quay St" });

    await GET_ONE(jsonRequest("http://localhost/api/sites/site-1"), params("site-1"));
    expect(authorize.mock.calls[0]?.[1]).toBeUndefined();

    await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1"));
    expect(authorize.mock.calls[1]?.[1]).toBe(true);

    await DELETE(jsonRequest("http://localhost/api/sites/site-1", { method: "DELETE" }), params("site-1"));
    expect(authorize.mock.calls[2]?.[1]).toBe(true);

    await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1"));
    expect(authorize.mock.calls[3]?.[1]).toBe(true);
  });

  it("returns 401 when unauthenticated", async () => {
    unauthorized();
    expect((await body(await GET_COLLECTION(jsonRequest("http://localhost/api/sites")))).status).toBe(401);
    expect((await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })))).status).toBe(401);
    expect((await body(await GET_ONE(jsonRequest("http://localhost/api/sites/site-1"), params("site-1")))).status).toBe(401);
    expect((await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).status).toBe(401);
    expect((await body(await DELETE(jsonRequest("http://localhost/api/sites/site-1", { method: "DELETE" }), params("site-1")))).status).toBe(401);
    expect((await body(await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1")))).status).toBe(401);
    expect(listSites).not.toHaveBeenCalled();
    expect(createSite).not.toHaveBeenCalled();
    expect(getSite).not.toHaveBeenCalled();
  });

  it("returns 403 for cookie mutations without a trusted origin", async () => {
    forbiddenOnMutation();
    const forbidden = await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })));
    expect(forbidden).toMatchObject({ status: 403, json: { error: "forbidden" } });
    expect((await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).status).toBe(403);
    expect((await body(await DELETE(jsonRequest("http://localhost/api/sites/site-1", { method: "DELETE" }), params("site-1")))).status).toBe(403);
    expect((await body(await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1")))).status).toBe(403);
    expect(createSite).not.toHaveBeenCalled();
    expect(updateSite).not.toHaveBeenCalled();
    expect(archiveSite).not.toHaveBeenCalled();
    expect(restoreSite).not.toHaveBeenCalled();
  });

  it("lists active sites by default and includes archived only for includeArchived=1", async () => {
    authed();
    listSites.mockResolvedValue([site]);

    const listed = await body(await GET_COLLECTION(jsonRequest("http://localhost/api/sites")));
    expect(listed.status).toBe(200);
    expect(listed.cache).toBe("no-store");
    expect(listed.json).toEqual([expect.objectContaining({ id: "site-1", name: "Harbour Offices", active: true })]);
    expect(listSites).toHaveBeenCalledWith({ tag: "db" }, "owner-a", false);

    await GET_COLLECTION(jsonRequest("http://localhost/api/sites?includeArchived=1"));
    expect(listSites).toHaveBeenLastCalledWith({ tag: "db" }, "owner-a", true);

    await GET_COLLECTION(jsonRequest("http://localhost/api/sites?includeArchived=true"));
    expect(listSites).toHaveBeenLastCalledWith({ tag: "db" }, "owner-a", false);

    await GET_COLLECTION(jsonRequest("http://localhost/api/sites?includeArchived=0"));
    expect(listSites).toHaveBeenLastCalledWith({ tag: "db" }, "owner-a", false);
  });

  it("creates a site with 201 and maps duplicate names to 409", async () => {
    authed();
    readJson.mockResolvedValue({ name: "Harbour Offices", address: "1 Quay St" });
    createSite.mockResolvedValue({ ...site, ownerUserId: "owner-a", createdAt: site.updatedAt });

    const created = await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })));
    expect(created.status).toBe(201);
    expect(created.json).toEqual(expect.objectContaining({ id: "site-1", name: "Harbour Offices" }));
    expect(createSite).toHaveBeenCalledWith({ tag: "db" }, "owner-a", { name: "Harbour Offices", address: "1 Quay St" });

    createSite.mockRejectedValue(new Error("duplicate_site"));
    expect(await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })))).toEqual({
      status: 409,
      json: { error: "duplicate_site" },
      cache: "no-store",
    });
  });

  it("maps zod failures to 400 and oversize bodies to 413", async () => {
    authed();
    readJson.mockResolvedValue({ name: "" });
    expect(await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })))).toMatchObject({
      status: 400,
      json: { error: "invalid_request" },
    });
    expect(createSite).not.toHaveBeenCalled();

    readJson.mockRejectedValue(new Error("payload_too_large"));
    expect(await body(await POST_COLLECTION(jsonRequest("http://localhost/api/sites", { method: "POST" })))).toMatchObject({
      status: 413,
      json: { error: "payload_too_large" },
    });
  });

  it("returns owner-scoped site details and 404 mapping", async () => {
    authed();
    getSite.mockResolvedValue(site);
    expect(await body(await GET_ONE(jsonRequest("http://localhost/api/sites/site-1"), params("site-1")))).toMatchObject({
      status: 200,
      json: { id: "site-1", name: "Harbour Offices", address: "1 Quay St", active: true },
    });
    expect(getSite).toHaveBeenCalledWith({ tag: "db" }, "owner-a", "site-1");

    getSite.mockRejectedValue(new Error("not_found"));
    expect(await body(await GET_ONE(jsonRequest("http://localhost/api/sites/missing"), params("missing")))).toEqual({
      status: 404,
      json: { error: "not_found" },
      cache: "no-store",
    });
  });

  it("patches, archives, and restores with 200 and maps not_found and duplicate_site", async () => {
    authed();
    readJson.mockResolvedValue({ name: "Harbour Tower", address: "2 Quay St" });
    updateSite.mockResolvedValue({ ...site, name: "Harbour Tower", address: "2 Quay St" });
    expect(await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).toMatchObject({
      status: 200,
      json: { id: "site-1", name: "Harbour Tower", address: "2 Quay St", active: true },
    });
    expect(updateSite).toHaveBeenCalledWith({ tag: "db" }, "owner-a", "site-1", { name: "Harbour Tower", address: "2 Quay St" });

    updateSite.mockRejectedValue(new Error("duplicate_site"));
    expect(await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).toMatchObject({
      status: 409,
      json: { error: "duplicate_site" },
    });

    updateSite.mockRejectedValue(new Error("not_found"));
    expect(await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).toMatchObject({
      status: 404,
      json: { error: "not_found" },
    });

    archiveSite.mockResolvedValue({ ...site, active: false });
    expect(await body(await DELETE(jsonRequest("http://localhost/api/sites/site-1", { method: "DELETE" }), params("site-1")))).toMatchObject({
      status: 200,
      json: { id: "site-1", active: false },
    });
    expect(archiveSite).toHaveBeenCalledWith({ tag: "db" }, "owner-a", "site-1");

    archiveSite.mockRejectedValue(new Error("not_found"));
    expect(await body(await DELETE(jsonRequest("http://localhost/api/sites/site-1", { method: "DELETE" }), params("site-1")))).toMatchObject({
      status: 404,
      json: { error: "not_found" },
    });

    restoreSite.mockResolvedValue(site);
    expect(await body(await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1")))).toMatchObject({
      status: 200,
      json: { id: "site-1", active: true },
    });
    expect(restoreSite).toHaveBeenCalledWith({ tag: "db" }, "owner-a", "site-1");

    restoreSite.mockRejectedValue(new Error("duplicate_site"));
    expect(await body(await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1")))).toMatchObject({
      status: 409,
      json: { error: "duplicate_site" },
    });

    restoreSite.mockRejectedValue(new Error("not_found"));
    expect(await body(await RESTORE(jsonRequest("http://localhost/api/sites/site-1/restore", { method: "POST" }), params("site-1")))).toMatchObject({
      status: 404,
      json: { error: "not_found" },
    });
  });

  it("rejects malformed ids before calling services", async () => {
    authed();
    const empty = await body(await GET_ONE(jsonRequest("http://localhost/api/sites/"), params("")));
    const oversize = await body(await PATCH(jsonRequest("http://localhost/api/sites/x", { method: "PATCH" }), params("x".repeat(65))));
    const restore = await body(await RESTORE(jsonRequest("http://localhost/api/sites/x/restore", { method: "POST" }), params("x".repeat(65))));
    const archived = await body(await DELETE(jsonRequest("http://localhost/api/sites/", { method: "DELETE" }), params("")));

    expect(empty).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    expect(oversize).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    expect(restore).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    expect(archived).toMatchObject({ status: 400, json: { error: "invalid_request" } });
    expect(getSite).not.toHaveBeenCalled();
    expect(updateSite).not.toHaveBeenCalled();
    expect(archiveSite).not.toHaveBeenCalled();
    expect(restoreSite).not.toHaveBeenCalled();
  });

  it("maps PATCH zod failures to 400 without writing", async () => {
    authed();
    readJson.mockResolvedValue({ name: "  " });
    expect(await body(await PATCH(jsonRequest("http://localhost/api/sites/site-1", { method: "PATCH" }), params("site-1")))).toMatchObject({
      status: 400,
      json: { error: "invalid_request" },
    });
    expect(updateSite).not.toHaveBeenCalled();
  });
});
