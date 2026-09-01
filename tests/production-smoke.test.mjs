import { describe, expect, it, vi } from "vitest";

import { verifyProductionRelease } from "../.github/scripts/production-smoke.mjs";

const releaseSha = "release-123";

function healthyResponse({ csp = true, release = releaseSha } = {}) {
  const headers = new Headers({
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  if (csp) headers.set("content-security-policy", "default-src 'self'; frame-ancestors 'none'");

  return new Response(JSON.stringify({ status: "ok", database: "ok", release }), {
    status: 200,
    headers,
  });
}

describe("production release smoke verification", () => {
  it("retries a delayed security header and cache-busts each attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse({ csp: false }))
      .mockResolvedValueOnce(healthyResponse());
    const sleep = vi.fn();
    const logger = { warn: vi.fn() };

    await verifyProductionRelease({
      productionUrl: "https://example.test",
      releaseSha,
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl,
      sleep,
      logger,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("smoke_attempt")).toBe("1");
    expect(new URL(fetchImpl.mock.calls[1][0]).searchParams.get("smoke_attempt")).toBe("2");
    expect(sleep).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      "Production smoke attempt 1/3 failed: Missing required content-security-policy response header",
    );
  });

  it("fails after the bounded retry window when the release identity is wrong", async () => {
    const fetchImpl = vi.fn(async () => healthyResponse({ release: "stale-release" }));
    const sleep = vi.fn();

    await expect(
      verifyProductionRelease({
        productionUrl: "https://example.test",
        releaseSha,
        maxAttempts: 2,
        retryDelayMs: 1,
        fetchImpl,
        sleep,
        logger: { warn: vi.fn() },
      }),
    ).rejects.toThrow("Health response does not match the active release");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
  });
});
