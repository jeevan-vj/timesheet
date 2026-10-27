import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  HOME_TITLE,
  SMOKE_COOKIE,
  SMOKE_MUTATION_PATH,
  SMOKE_ORIGIN,
  verifyProductionRelease,
} from "../.github/scripts/production-smoke.mjs";

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

function textResponse(status, body, contentType) {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

describe("production release smoke verification", () => {
  it("retries a delayed security header and cache-busts each attempt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse({ csp: false }))
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(textResponse(401, JSON.stringify({ error: "unauthorized" }), "application/json"))
      .mockResolvedValueOnce(textResponse(403, JSON.stringify({ error: "forbidden" }), "application/json"))
      .mockResolvedValueOnce(textResponse(200, `<title>${HOME_TITLE}</title>`, "text/html"));
    const sleep = vi.fn();
    const logger = { warn: vi.fn() };

    await verifyProductionRelease({
      productionUrl: "https://example.test",
      releaseSha,
      versionTag: releaseSha,
      maxAttempts: 3,
      retryDelayMs: 1,
      fetchImpl,
      sleep,
      logger,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(5);
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
        versionTag: releaseSha,
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

  it("rejects a deployed version tag that is not the release SHA before any request", async () => {
    const fetchImpl = vi.fn();

    await expect(
      verifyProductionRelease({
        productionUrl: "https://example.test",
        releaseSha,
        versionTag: "other-sha",
        maxAttempts: 2,
        fetchImpl,
        sleep: vi.fn(),
        logger: { warn: vi.fn() },
      }),
    ).rejects.toThrow("Deployed version tag does not match the release SHA");

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks signed-out identity, a read-only cross-origin mutation, and the home title on a local server", async () => {
    const requests = [];
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          method: request.method,
          path: url.pathname,
          origin: request.headers.origin ?? "",
          cookie: request.headers.cookie ?? "",
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (request.method === "GET" && url.pathname === "/api/health") {
          response.writeHead(200, {
            "cache-control": "no-store",
            "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
            "content-type": "application/json",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            "x-frame-options": "DENY",
          });
          response.end(JSON.stringify({ status: "ok", database: "ok", release: releaseSha }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/api/me") {
          response.writeHead(401, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "unauthorized" }));
          return;
        }
        if (request.method === "POST" && url.pathname === SMOKE_MUTATION_PATH) {
          const blocked = request.headers.cookie && request.headers.origin === SMOKE_ORIGIN;
          response.writeHead(blocked ? 403 : 500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: blocked ? "forbidden" : "unexpected" }));
          return;
        }
        if (request.method === "GET" && url.pathname === "/") {
          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><title>${HOME_TITLE}</title>`);
          return;
        }
        response.writeHead(404);
        response.end();
      });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();

    try {
      await verifyProductionRelease({
        productionUrl: `http://127.0.0.1:${port}`,
        releaseSha,
        versionTag: releaseSha,
        maxAttempts: 1,
        retryDelayMs: 1,
        logger: { warn: vi.fn() },
      });
    } finally {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /api/health",
      "GET /api/me",
      "POST /api/sites",
      "GET /",
    ]);
    const mutation = requests[2];
    expect(mutation.origin).toBe(SMOKE_ORIGIN);
    expect(mutation.cookie).toBe(SMOKE_COOKIE);
    expect(mutation.body).toBe("{}");
    expect(requests.every((request) => request.method === "GET" || request.path === SMOKE_MUTATION_PATH)).toBe(true);
  });
});
