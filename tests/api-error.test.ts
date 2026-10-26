import fs from "node:fs";
import path from "node:path";
import { DrizzleQueryError } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { calculateEntryPayCents, weekEnd } from "../src/lib/payroll";

const workerEnv = vi.hoisted(() => ({
  DB: { prepare: vi.fn() },
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://app.example.test",
  AUTH_TRUSTED_ORIGINS: "",
  RELEASE_SHA: "rel-sha-test",
  SENTRY_DSN: undefined as string | undefined,
}));

const services = vi.hoisted(() => ({
  getDashboard: vi.fn(),
  listAssignments: vi.fn(),
  createAssignment: vi.fn(),
  getAssignment: vi.fn(),
  unassignAssignment: vi.fn(),
  updateAssignmentRate: vi.fn(),
  listContractors: vi.fn(),
  createContractor: vi.fn(),
  getTimeEntry: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
vi.mock("@/db/client", () => ({ db: { tag: "db" } }));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async (request: Request) => {
    if (!request.headers.get("cookie")) return null;
    return { id: "owner-1", email: "owner@example.test", name: "Owner" };
  },
}));
vi.mock("@/lib/runtime-env", () => ({
  getTrustedOrigins: () => ["https://app.example.test"],
  getSecureCookies: () => true,
}));
vi.mock("@/services/timesheet", () => services);

import { apiError, readJson } from "../src/lib/api";
import { GET as getDashboard } from "../src/app/api/dashboard/route";
import { GET as listAssignments } from "../src/app/api/assignments/route";
import { DELETE as deleteAssignment } from "../src/app/api/assignments/[id]/route";
import { GET as listContractors } from "../src/app/api/contractors/route";
import { GET as getTimeEntry } from "../src/app/api/time-entries/[id]/route";

const SQL_TEXT = "SELECT secret_note, rate_cents FROM time_entry WHERE note = ?";
const NOTE = "NOTE-SECRET-ALPHA";
const RATE = "424242";
const INBOUND_ID = "11111111-1111-4111-8111-111111111111";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ErrorJson = { error: string; correlationId?: string };

async function errorJson(response: Response): Promise<ErrorJson> {
  return response.json() as Promise<ErrorJson>;
}

const expectedErrors = [
  ["payload_too_large", 413, "payload_too_large"],
  ["not_found", 404, "not_found"],
  ["invalid_request", 400, "invalid_request"],
  ["invalid_shift", 400, "invalid_shift"],
  ["invalid_week", 400, "invalid_request"],
  ["no_entries", 400, "no_entries"],
  ["missing_remitter", 400, "missing_remitter"],
  ["duplicate_contractor", 409, "duplicate_contractor"],
  ["duplicate_site", 409, "duplicate_site"],
  ["duplicate_assignment", 409, "duplicate_assignment"],
  ["duplicate_entry", 409, "duplicate_entry"],
  ["week_locked", 409, "week_locked"],
  ["stale_week", 409, "stale_week"],
  ["week_not_approved", 409, "week_not_approved"],
  ["schedule_exists", 409, "schedule_exists"],
  ["no_schedule", 409, "no_schedule"],
  ["business_required", 409, "business_required"],
  ["contractor_email_required", 409, "contractor_email_required"],
  ["invitation_exists", 409, "invitation_exists"],
  ["invitation_not_pending", 409, "invitation_not_pending"],
  ["already_linked", 409, "already_linked"],
] as const;

function filesUnder(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function request(url = "https://app.example.test/api/sites?note=NOTE-SECRET-ALPHA", method = "POST") {
  return new Request(url, {
    method,
    headers: {
      "x-request-id": INBOUND_ID,
      "x-correlation-id": INBOUND_ID,
      "cf-ray": "ray-should-be-ignored",
      traceparent: "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01",
    },
  });
}

function authed(url: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: "better-auth.session_token=test",
      origin: "https://app.example.test",
      ...headers,
    },
  });
}

describe("apiError", () => {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response("", { status: 200 }));
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workerEnv.SENTRY_DSN = undefined;
    workerEnv.RELEASE_SHA = "rel-sha-test";
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fn of Object.values(services)) fn.mockReset();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("keeps a single structured console.error in the server reporter", () => {
    const hits = filesUnder(path.resolve("src"))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .filter((file) => /\bconsole\.(log|info|debug|warn|error)\s*\(/.test(fs.readFileSync(file, "utf8")));
    expect(hits.map((file) => path.relative(path.resolve("src"), file))).toEqual(["lib/report-server-error.ts"]);
    const source = fs.readFileSync(path.resolve("src/lib/report-server-error.ts"), "utf8");
    expect(source.match(/console\.error\s*\(/g)).toHaveLength(1);
    expect(source).toMatch(/console\.error\(\s*JSON\.stringify\(/);
    expect(source).not.toMatch(/\b(TODO|FIXME|HACK|XXX|workaround)\b/i);
  });

  it.each(expectedErrors)("returns %s as %i %s without logging or capture", async (message, status, code) => {
    workerEnv.SENTRY_DSN = "https://public-key@example.test/42";
    const response = await apiError(new Error(message), request());
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: code });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps ZodError from parse to invalid_request and does not log the issues", async () => {
    let thrown: unknown;
    try {
      z.object({ note: z.string() }).parse({ note: 1, extra: NOTE });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(z.ZodError);
    const response = await apiError(thrown, request());
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 500 for pay and week derivation failures without echoing the code", async () => {
    let payError: unknown;
    try {
      calculateEntryPayCents(0, 1);
    } catch (error) {
      payError = error;
    }
    let weekError: unknown;
    try {
      weekEnd("2026-09-01");
    } catch (error) {
      weekError = error;
    }
    for (const error of [payError, weekError, new Error("invalid_pay_input"), new Error("invalid_week_start")]) {
      errorSpy.mockClear();
      const response = await apiError(error, request("https://app.example.test/api/weeks/approve?week=2026-09-01", "POST"));
      expect(response.status).toBe(500);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await errorJson(response);
      expect(body).toEqual({ error: "internal_error", correlationId: expect.stringMatching(UUID) });
      expect(JSON.stringify(body)).not.toMatch(/invalid_pay_input|invalid_week_start/);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("ignores inbound request ids and returns only error plus a server correlation id", async () => {
    const response = await apiError(new Error("database_unavailable"), request());
    const body = await errorJson(response);
    expect(response.status).toBe(500);
    expect(Object.keys(body).sort()).toEqual(["correlationId", "error"]);
    expect(body.error).toBe("internal_error");
    expect(body.correlationId).toMatch(UUID);
    expect(body.correlationId).not.toBe(INBOUND_ID);
    const logged = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(logged.correlationId).toBe(body.correlationId);
    expect(logged.correlationId).not.toBe(INBOUND_ID);
    expect(String(errorSpy.mock.calls[0][0])).not.toContain("ray-should-be-ignored");
    expect(String(errorSpy.mock.calls[0][0])).not.toContain("traceparent");
  });

  it("logs one scrubbed line with the release and strips the query string", async () => {
    const response = await apiError(new Error("database_unavailable"), request());
    const body = await errorJson(response);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0]).toHaveLength(1);
    const logged = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(logged).toEqual({
      route: "/api/sites",
      method: "POST",
      correlationId: body.correlationId,
      name: "Error",
      message: "database_unavailable",
      stack: expect.any(String),
      release: "rel-sha-test",
    });
    expect(Object.keys(logged)).toEqual(["route", "method", "correlationId", "name", "message", "stack", "release"]);
    expect(logged.stack).toContain("database_unavailable");
    expect(String(errorSpy.mock.calls[0][0])).not.toContain(NOTE);
  });

  it("does not call fetch when the DSN is unset, empty, or whitespace", async () => {
    for (const dsn of [undefined, "", "   \n"]) {
      workerEnv.SENTRY_DSN = dsn;
      fetchMock.mockClear();
      errorSpy.mockClear();
      const response = await apiError(new Error("database_unavailable"), request());
      expect(response.status).toBe(500);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    }
  });

  it("redacts query failures in the log and the capture envelope", async () => {
    workerEnv.SENTRY_DSN = "https://public-key@example.test/42";
    const failure = new DrizzleQueryError(SQL_TEXT, [NOTE, 424242], new Error(`D1_ERROR: SQLITE_CONSTRAINT ${NOTE}`));
    const response = await apiError(failure, request("https://app.example.test/api/time-entries?note=NOTE-SECRET-ALPHA", "POST"));
    const body = await errorJson(response);
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ error: "internal_error", correlationId: expect.stringMatching(UUID) });
    expect(JSON.stringify(body)).not.toContain(NOTE);
    expect(JSON.stringify(body)).not.toContain(RATE);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logLine = String(errorSpy.mock.calls[0][0]);
    const logged = JSON.parse(logLine);
    expect(logged).toMatchObject({
      route: "/api/time-entries",
      method: "POST",
      correlationId: body.correlationId,
      name: "Error",
      message: "query_failed",
      release: "rel-sha-test",
    });
    expect(logged.stack).toContain("query_failed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    const init = fetchMock.mock.calls[0][1];
    expect(init).toBeDefined();
    const sent = String(init?.body);
    expect(url).toBe("https://example.test/api/42/envelope/");
    expect(init?.method).toBe("POST");
    expect(sent).toContain(body.correlationId);
    expect(sent).toContain("query_failed");
    expect(sent).toContain("rel-sha-test");
    for (const secret of [NOTE, RATE, "params", SQL_TEXT, "D1_ERROR", "SQLITE_", "public-key@example.test"]) {
      expect(logLine).not.toContain(secret);
      expect(sent).not.toContain(secret);
      expect(url).not.toContain(secret);
    }
    expect(JSON.stringify(body)).not.toContain(SQL_TEXT);
  });

  it("redacts driver text when the message matches and when the value is not an Error", async () => {
    workerEnv.SENTRY_DSN = "https://public-key@example.test/42";
    const driver = new Error(`D1_ERROR: SQLITE_CONSTRAINT ${NOTE}`);
    driver.stack = `${driver.stack}\nparams: ${RATE}`;
    const response = await apiError(driver, request());
    const body = await errorJson(response);
    const logLine = String(errorSpy.mock.calls[0][0]);
    expect(JSON.parse(logLine).message).toBe("query_failed");
    expect(logLine).not.toContain(NOTE);
    expect(logLine).not.toContain(RATE);
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain(body.correlationId);

    errorSpy.mockClear();
    fetchMock.mockClear();
    const thrown = await apiError(NOTE, request());
    expect(thrown.status).toBe(500);
    const nonErrorLog = String(errorSpy.mock.calls[0][0]);
    expect(JSON.parse(nonErrorLog)).toMatchObject({ name: "NonError", message: "unexpected_throw" });
    expect(nonErrorLog).not.toContain(NOTE);
    expect(await thrown.json()).toEqual({ error: "internal_error", correlationId: expect.stringMatching(UUID) });
  });

  it("still returns 500 when capture fails", async () => {
    workerEnv.SENTRY_DSN = "https://public-key@example.test/42";
    fetchMock.mockRejectedValue(new Error(`connect refused ${NOTE}`));
    const response = await apiError(new Error("database_unavailable"), request());
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await errorJson(response);
    expect(body.error).toBe("internal_error");
    expect(body.correlationId).toMatch(UUID);
    expect(JSON.stringify(body)).not.toContain(NOTE);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).not.toContain(NOTE);
  });

  it("turns malformed JSON with a legal content-length into invalid_request", async () => {
    const payload = `{not-json ${NOTE}`;
    const incoming = new Request("https://app.example.test/api/contractors", {
      method: "POST",
      body: payload,
      headers: {
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(payload)),
      },
    });
    let thrown: unknown;
    try {
      await readJson(incoming);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("invalid_request");
    expect((thrown as Error).cause).toBeUndefined();
    expect(String(thrown)).not.toContain(NOTE);
    const response = await apiError(thrown, incoming);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(errorSpy).not.toHaveBeenCalled();
    expect(String(response.status)).not.toContain(NOTE);
  });

  it("rejects missing, non-positive, and oversized content lengths before parsing", async () => {
    const missing = new Request("https://app.example.test/api/sites", { method: "POST", body: "{}" });
    missing.headers.delete("content-length");
    const zero = new Request("https://app.example.test/api/sites", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "0" },
    });
    const negative = new Request("https://app.example.test/api/sites", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "-1" },
    });
    const oversized = new Request("https://app.example.test/api/sites", {
      method: "POST",
      body: "{}",
      headers: { "content-length": "16385" },
    });
    for (const incoming of [missing, zero, negative, oversized]) {
      await expect(readJson(incoming)).rejects.toThrow("payload_too_large");
    }
    const accepted = new Request("https://app.example.test/api/sites", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json", "content-length": "16384" },
    });
    await expect(readJson(accepted)).resolves.toEqual({});
  });
});

describe("routes that previously let failures escape", () => {
  const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response("", { status: 200 }));
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    workerEnv.SENTRY_DSN = undefined;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const fn of Object.values(services)) fn.mockReset();
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("rejects a bad dashboard week before the read", async () => {
    services.getDashboard.mockRejectedValue(new Error(`D1_ERROR: ${NOTE}`));
    const response = await getDashboard(authed("https://app.example.test/api/dashboard?week=2026-09-01"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_week" });
    expect(services.getDashboard).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns 401 from dashboard authorize and 500 when the read throws", async () => {
    const anonymous = await getDashboard(new Request("https://app.example.test/api/dashboard?week=2026-08-31"));
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
    expect(services.getDashboard).not.toHaveBeenCalled();

    services.getDashboard.mockRejectedValue(new DrizzleQueryError(SQL_TEXT, [NOTE, 424242]));
    const response = await getDashboard(authed("https://app.example.test/api/dashboard?week=2026-08-31"));
    expect(response.status).toBe(500);
    const body = await errorJson(response);
    expect(body.error).toBe("internal_error");
    expect(body.correlationId).toMatch(UUID);
    expect(JSON.stringify(body)).not.toContain(NOTE);
    expect(JSON.stringify(body)).not.toContain(SQL_TEXT);
    expect(String(errorSpy.mock.calls[0][0])).not.toContain(NOTE);
    expect(services.getDashboard).toHaveBeenCalledWith({ tag: "db" }, "owner-1", "2026-08-31");
  });

  it("returns 500 from assignment list and delete without replacing authorize", async () => {
    const anonymous = await listAssignments(new Request("https://app.example.test/api/assignments"));
    expect(anonymous.status).toBe(401);

    services.listAssignments.mockRejectedValue(new Error("D1_ERROR: SQLITE_CONSTRAINT"));
    const listed = await listAssignments(authed("https://app.example.test/api/assignments"));
    expect(listed.status).toBe(500);
    expect((await errorJson(listed)).error).toBe("internal_error");

    const forbidden = await deleteAssignment(
      new Request("https://app.example.test/api/assignments/site-1", {
        method: "DELETE",
        headers: { cookie: "better-auth.session_token=test" },
      }),
      { params: Promise.resolve({ id: "site-1" }) },
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "forbidden" });
    expect(services.unassignAssignment).not.toHaveBeenCalled();

    services.unassignAssignment.mockRejectedValue(new Error(`SQLITE_CONSTRAINT ${NOTE}`));
    const deleted = await deleteAssignment(authed("https://app.example.test/api/assignments/site-1", "DELETE"), {
      params: Promise.resolve({ id: "site-1" }),
    });
    expect(deleted.status).toBe(500);
    expect(JSON.stringify(await deleted.json())).not.toContain(NOTE);
  });

  it("rejects a bad includeArchived flag and hides contractor list failures", async () => {
    services.listContractors.mockRejectedValue(new Error(`D1_ERROR: ${NOTE}`));
    const invalid = await listContractors(authed("https://app.example.test/api/contractors?includeArchived=yes"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
    expect(services.listContractors).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    services.listContractors.mockRejectedValue(new DrizzleQueryError(SQL_TEXT, [NOTE, 424242]));
    const response = await listContractors(authed("https://app.example.test/api/contractors"));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(NOTE);
    expect(String(errorSpy.mock.calls.at(-1)?.[0])).not.toContain(RATE);
  });

  it("returns 500 when loading one time entry throws", async () => {
    const anonymous = await getTimeEntry(new Request("https://app.example.test/api/time-entries/entry-1"), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(anonymous.status).toBe(401);
    expect(services.getTimeEntry).not.toHaveBeenCalled();

    services.getTimeEntry.mockRejectedValue(new DrizzleQueryError(SQL_TEXT, [NOTE, 424242]));
    const response = await getTimeEntry(authed("https://app.example.test/api/time-entries/entry-1"), {
      params: Promise.resolve({ id: "entry-1" }),
    });
    expect(response.status).toBe(500);
    const body = await errorJson(response);
    expect(body).toEqual({ error: "internal_error", correlationId: expect.stringMatching(UUID) });
    expect(JSON.stringify(body)).not.toContain(SQL_TEXT);
    expect(String(errorSpy.mock.calls[0][0])).not.toContain(NOTE);
  });
});
