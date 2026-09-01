import { beforeEach, describe, expect, it, vi } from "vitest";

const workerEnv = vi.hoisted(() => ({
  DB: {
    prepare: vi.fn(),
  },
  RELEASE_SHA: "test-release",
}));

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));

import { GET } from "../src/app/api/health/route";

describe("deployment health endpoint", () => {
  beforeEach(() => {
    workerEnv.DB.prepare.mockReset();
  });

  it("reports database health and the safe release marker", async () => {
    workerEnv.DB.prepare.mockReturnValue({
      first: vi.fn().mockResolvedValue({ ok: 1 }),
    });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Permissions-Policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(await response.json()).toEqual({
      status: "ok",
      database: "ok",
      release: "test-release",
    });
  });

  it("returns a non-disclosing failure when D1 is unavailable", async () => {
    workerEnv.DB.prepare.mockReturnValue({
      first: vi.fn().mockRejectedValue(new Error("sensitive database error")),
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
