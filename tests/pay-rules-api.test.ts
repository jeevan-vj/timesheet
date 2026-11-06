import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openPortalSqlite, portalDatabase } from "./portal-db";
import { seedOwnerWorkspace } from "./owner-workspace";

const session = vi.hoisted(() => ({
  user: { id: "owner-a", email: "owner@example.test", name: "Owner" } as { id: string; email: string; name: string } | null,
}));
const handle = vi.hoisted(() => ({ database: null as unknown }));

vi.mock("cloudflare:workers", () => ({ env: { DB: { prepare: vi.fn() }, BETTER_AUTH_SECRET: "test", BETTER_AUTH_URL: "https://app.example.test", AUTH_TRUSTED_ORIGINS: "" } }));
vi.mock("@/db/client", () => ({
  db: new Proxy({}, {
    get(_target, prop) {
      const database = handle.database as Record<PropertyKey, unknown>;
      const value = database[prop];
      return typeof value === "function" ? value.bind(database) : value;
    },
  }),
}));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async (request: Request) => request.headers.get("cookie") ? session.user : null,
}));

import { GET as getPayRules, PUT as putPayRules } from "../src/app/api/business/pay-rules/route";
import { GET as getHolidays, POST as postHoliday } from "../src/app/api/business/holidays/route";
import { DELETE as deleteHoliday } from "../src/app/api/business/holidays/[id]/route";

const origin = "https://app.example.test";

function request(path: string, method = "GET", body?: unknown, authenticated = true) {
  const encoded = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`${origin}${path}`, {
    method,
    body: encoded,
    headers: {
      ...(authenticated ? { cookie: "better-auth.session_token=test" } : {}),
      ...(method === "GET" ? {} : { origin, "content-type": "application/json", "content-length": String(Buffer.byteLength(encoded ?? "")) }),
    },
  });
}

describe("owner pay rules API", () => {
  let sqlite: SqlJsDatabase;

  beforeEach(async () => {
    sqlite = await openPortalSqlite();
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('contractor-a', 'Contractor', 'contractor@example.test', 1, 1, 1)");
    handle.database = portalDatabase(sqlite);
    session.user = { id: "owner-a", email: "owner@example.test", name: "Owner" };
  });

  it("returns 401 without a session and 403 for a contractor session", async () => {
    const unauthenticatedHandlers = [
      () => getPayRules(request("/api/business/pay-rules", "GET", undefined, false)),
      () => putPayRules(request("/api/business/pay-rules", "PUT", {}, false)),
      () => getHolidays(request("/api/business/holidays", "GET", undefined, false)),
      () => postHoliday(request("/api/business/holidays", "POST", {}, false)),
      () => deleteHoliday(request("/api/business/holidays/holiday-a", "DELETE", {}, false), { params: Promise.resolve({ id: "holiday-a" }) }),
    ];
    for (const handler of unauthenticatedHandlers) {
      const response = await handler();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    session.user = { id: "contractor-a", email: "contractor@example.test", name: "Contractor" };
    const contractorHandlers = [
      () => getPayRules(request("/api/business/pay-rules")),
      () => putPayRules(request("/api/business/pay-rules", "PUT", {})),
      () => getHolidays(request("/api/business/holidays")),
      () => postHoliday(request("/api/business/holidays", "POST", {})),
      () => deleteHoliday(request("/api/business/holidays/holiday-a", "DELETE", {}), { params: Promise.resolve({ id: "holiday-a" }) }),
    ];
    for (const handler of contractorHandlers) {
      const response = await handler();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
  });

  it("lets an owner read, upsert, add, list, and delete", async () => {
    const initial = await getPayRules(request("/api/business/pay-rules"));
    expect(await initial.json()).toEqual({
      holidayMode: "off",
      holidayMultiplierBps: null,
      useNzPublicHolidays: false,
      weekendSaturdayMultiplierBps: null,
      weekendSundayMultiplierBps: null,
      overnightStartMinutes: null,
      overnightEndMinutes: null,
      overnightMultiplierBps: null,
    });
    const input = {
      holidayMode: "multiplier",
      holidayMultiplierBps: 15_000,
      useNzPublicHolidays: true,
      weekendSaturdayMultiplierBps: 12_500,
      weekendSundayMultiplierBps: null,
      overnightStartMinutes: 1_320,
      overnightEndMinutes: 360,
      overnightMultiplierBps: 15_000,
    };
    const updated = await putPayRules(request("/api/business/pay-rules", "PUT", input));
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual(input);
    expect(await (await getPayRules(request("/api/business/pay-rules"))).json()).toEqual(input);

    const created = await postHoliday(request("/api/business/holidays", "POST", { holidayDate: "2026-11-06", name: "Owner holiday" }));
    expect(created.status).toBe(201);
    const holiday = await created.json() as { id: string; holidayDate: string; name: string };
    expect(holiday).toMatchObject({ holidayDate: "2026-11-06", name: "Owner holiday" });
    expect(await (await getHolidays(request("/api/business/holidays"))).json()).toMatchObject({ holidays: [{ id: holiday.id }] });
    const removed = await deleteHoliday(request(`/api/business/holidays/${holiday.id}`, "DELETE", {}), { params: Promise.resolve({ id: holiday.id }) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ ok: true });
  });
});
