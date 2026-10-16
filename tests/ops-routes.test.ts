import { beforeEach, describe, expect, it, vi } from "vitest";

const ops = vi.hoisted(() => ({
  opsCreateContractor: vi.fn(),
  opsWages: vi.fn(),
  opsPreviewSql: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    OPS_BOT_TOKEN: "ops-test-token",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
    RELEASE_SHA: "local",
  },
}));
vi.mock("@/db/client", () => ({ db: { tag: "mock-db" } }));
vi.mock("@/services/ops", () => ops);

import { POST as createContractor } from "../src/app/api/ops/contractors/route";
import { GET as wages } from "../src/app/api/ops/wages/route";
import { POST as previewSql } from "../src/app/api/ops/sql/route";

function jsonRequest(url: string, body: unknown, token?: string) {
  const encoded = JSON.stringify(body);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "content-length": String(Buffer.byteLength(encoded)),
    cookie: "better-auth.session_token=test",
    origin: "https://app.example.test",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(url, { method: "POST", body: encoded, headers });
}

describe("ops routes", () => {
  beforeEach(() => {
    ops.opsCreateContractor.mockReset();
    ops.opsWages.mockReset();
    ops.opsPreviewSql.mockReset();
  });

  it("rejects a cookie session that has no ops bearer token", async () => {
    const response = await createContractor(jsonRequest("https://app.example.test/api/ops/contractors", {
      ownerUserId: "owner-a",
      name: "Aroha",
      defaultRateCents: 3_000,
      reason: "Add contractor",
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(ops.opsCreateContractor).not.toHaveBeenCalled();

    const read = await wages(new Request("https://app.example.test/api/ops/wages?ownerUserId=owner-a&week=2026-08-31", {
      headers: { cookie: "better-auth.session_token=test" },
    }));
    expect(read.status).toBe(401);
    expect(ops.opsWages).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token before reading payroll", async () => {
    const response = await wages(new Request("https://app.example.test/api/ops/wages?ownerUserId=owner-a&week=2026-08-31", {
      headers: { authorization: "Bearer wrong-token" },
    }));
    expect(response.status).toBe(401);
    expect(ops.opsWages).not.toHaveBeenCalled();
  });

  it("uses the bearer token and the named owner", async () => {
    ops.opsCreateContractor.mockResolvedValue({ contractor: { id: "c1" }, auditId: "audit-1" });
    const response = await createContractor(jsonRequest("https://app.example.test/api/ops/contractors", {
      ownerUserId: "owner-a",
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      reason: "Add contractor",
    }, "ops-test-token"));
    expect(response.status).toBe(201);
    expect(ops.opsCreateContractor).toHaveBeenCalledWith({ tag: "mock-db" }, {
      ownerUserId: "owner-a",
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 3_000,
      reason: "Add contractor",
    });
  });

  it("does not preview sql without the ops token", async () => {
    const response = await previewSql(jsonRequest("https://app.example.test/api/ops/sql", {
      sql: "SELECT 1",
      params: [],
    }, "wrong-token"));
    expect(response.status).toBe(401);
    expect(ops.opsPreviewSql).not.toHaveBeenCalled();
  });
});
