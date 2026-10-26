import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

const session = vi.hoisted(() => ({
  user: { id: "owner-a", email: "owner-a@example.test", name: "Owner A" } as { id: string; email: string; name: string } | null,
}));

const workerEnv = vi.hoisted(() => ({
  DB: { prepare: vi.fn() },
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://app.example.test",
  AUTH_TRUSTED_ORIGINS: "",
  RELEASE_SHA: "test",
  EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>",
  RESEND_API_KEY: "resend-test-key",
}));

const handle = vi.hoisted(() => ({ database: null as unknown }));

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));
vi.mock("@/db/client", () => ({
  db: new Proxy({}, {
    get(_target, prop) {
      const database = handle.database as Record<PropertyKey, unknown> | null;
      if (!database) throw new Error("database unavailable");
      const value = database[prop];
      return typeof value === "function" ? value.bind(database) : value;
    },
  }),
}));
vi.mock("@/lib/request-session", () => ({
  requireSessionUser: async () => session.user,
}));

import { GET as readInvitation, POST as createInvitation } from "../src/app/api/contractors/[id]/invitation/route";
import { POST as resendInvitation } from "../src/app/api/contractors/[id]/invitation/resend/route";
import { POST as revokeInvitation } from "../src/app/api/contractors/[id]/invitation/revoke/route";

const ORIGIN = "https://app.example.test";

function cookieRequest(url: string, method = "GET", headers: Record<string, string> = {}) {
  return new Request(url, {
    method,
    headers: { cookie: "better-auth.session_token=test", origin: ORIGIN, ...headers },
  });
}

function seedContractor(sqlite: SqlJsDatabase) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
    ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha North', 'aroha@example.test', '', 3200, 'NZD', 1)`,
  );
}

describe("invitation routes", () => {
  let sqlite: SqlJsDatabase;

  beforeEach(async () => {
    session.user = { id: "owner-a", email: "owner-a@example.test", name: "Owner A" };
    workerEnv.RESEND_API_KEY = "resend-test-key";
    sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    seedOwnerWorkspace(sqlite, "owner-b");
    sqlite.run("UPDATE business SET name = 'Northwind', contact_email = 'office@example.test' WHERE id = 'biz_owner-a'");
    seedContractor(sqlite);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "email_123" })));
  });

  it("requires a session and a trusted origin", async () => {
    session.user = null;
    const params = { params: Promise.resolve({ id: "c1" }) };
    expect((await readInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation"), params)).status).toBe(401);
    session.user = { id: "owner-a", email: "owner-a@example.test", name: "Owner A" };
    const missingOrigin = new Request("https://app.example.test/api/contractors/c1/invitation", {
      method: "POST",
      headers: { cookie: "better-auth.session_token=test" },
    });
    expect((await createInvitation(missingOrigin, params)).status).toBe(403);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM contractor_invitation")).toEqual([[0]]);
  });

  it("hides another owner's contractor and returns the link only from the mutation", async () => {
    const params = { params: Promise.resolve({ id: "c1" }) };
    session.user = { id: "owner-b", email: "owner-b@example.test", name: "Owner B" };
    const hidden = await createInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation", "POST"), params);
    expect(hidden.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "not_found" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM contractor_invitation")).toEqual([[0]]);

    session.user = { id: "owner-a", email: "owner-a@example.test", name: "Owner A" };
    const created = await createInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation", "POST"), params);
    expect(created.status).toBe(201);
    const body = await created.json() as { invitation: { state: string }; delivery: string; inviteLink: string };
    expect(body.delivery).toBe("email");
    expect(body.invitation.state).toBe("pending");
    const token = new URL(body.inviteLink).hash.slice(1);
    expect(token.length).toBeGreaterThan(20);
    expect(body.inviteLink).toBe(`https://app.example.test/invite#${token}`);
    expect(JSON.stringify(body.invitation)).not.toContain(token);

    const listed = await readInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation"), params);
    expect(listed.status).toBe(200);
    const view = await listed.json() as { state: string };
    expect(view.state).toBe("pending");
    expect(JSON.stringify(view)).not.toContain(token);

    const again = await createInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation", "POST"), params);
    expect(again.status).toBe(409);
    const conflict = await again.json() as { error: string; invitation: { state: string } };
    expect(conflict.error).toBe("invitation_exists");
    expect(conflict.invitation.state).toBe("pending");
    expect(JSON.stringify(conflict)).not.toContain(token);

    const resent = await resendInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation/resend", "POST"), params);
    expect(resent.status).toBe(200);
    const resentBody = await resent.json() as { inviteLink: string };
    expect(new URL(resentBody.inviteLink).hash.slice(1)).not.toBe(token);

    const revoked = await revokeInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation/revoke", "POST"), params);
    expect(revoked.status).toBe(200);
    expect(await revoked.json()).toMatchObject({ invitation: { state: "revoked" } });
    expect(sqlRows(sqlite, "SELECT engagement_status FROM contractor WHERE id = 'c1'")).toEqual([["invited"]]);
  });

  it("still creates the invite when the key is missing and does not call Resend", async () => {
    workerEnv.RESEND_API_KEY = "";
    const fetchImpl = vi.fn();
    vi.stubGlobal("fetch", fetchImpl);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const params = { params: Promise.resolve({ id: "c1" }) };
    const created = await createInvitation(cookieRequest("https://app.example.test/api/contractors/c1/invitation", "POST"), params);
    expect(created.status).toBe(201);
    const body = await created.json() as { delivery: string; inviteLink: string };
    expect(body.delivery).toBe("link_only");
    expect(body.inviteLink).toContain("#");
    expect(fetchImpl).not.toHaveBeenCalled();
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("email_not_configured");
    expect(logged).not.toContain(new URL(body.inviteLink).hash.slice(1));
    expect(logged).not.toContain("aroha@example.test");
    spy.mockRestore();
  });
});
