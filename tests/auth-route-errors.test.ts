import { afterEach, expect, it, vi } from "vitest";
const handler = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: handler, POST: handler }) }));
import { GET, POST } from "../src/app/api/auth/[...all]/route";

afterEach(() => vi.restoreAllMocks());

it.each([GET, POST])("contains unexpected auth failures without exposing or logging details", async (route) => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  handler.mockRejectedValue(new Error("private database parameters"));
  const response = await route(new Request("https://example.test/api/auth/get-session"));
  expect(response.status).toBe(503);
  expect(await response.text()).toBe('{"error":"service_unavailable"}');
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(log).not.toHaveBeenCalled();
});

it.each([GET, POST])("preserves auth responses and cookies", async (route) => {
  const response = new Response(null, { status: 302, headers: { location: "/dashboard", "set-cookie": "test-session=fixture; HttpOnly" } });
  handler.mockResolvedValue(response);
  expect(await route(new Request("https://example.test/api/auth/callback"))).toBe(response);
});
