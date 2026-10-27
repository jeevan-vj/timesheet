import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../src/lib/auth-options";
import { invitationTokenDigest } from "../src/lib/invitation-token";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

const session = vi.hoisted(() => ({
  user: null as { id: string; email: string; name: string } | null,
}));

const workerEnv = vi.hoisted(() => ({
  DB: { prepare: vi.fn() },
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://app.example.test",
  AUTH_TRUSTED_ORIGINS: "",
  RELEASE_SHA: "test",
  EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>",
  RESEND_API_KEY: "",
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

import { POST as acceptInvite } from "../src/app/api/invitations/accept/route";
import { POST as previewInvite } from "../src/app/api/invitations/preview/route";

const ORIGIN = "https://app.example.test";
const TOKEN = "invite-token-value-0123456789abcdef";
const PASSWORD = "cleaner-pass-123456";

function post(path: string, body: unknown, options?: { origin?: string | null; ip?: string }) {
  const payload = JSON.stringify(body);
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": String(payload.length),
    "cf-connecting-ip": options?.ip ?? "203.0.113.10",
  });
  if (options?.origin !== null) headers.set("origin", options?.origin ?? ORIGIN);
  return new Request(`https://app.example.test${path}`, { method: "POST", headers, body: payload });
}

function seedContractor(sqlite: SqlJsDatabase) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
    ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha North', 'aroha@example.test', '', 3200, 'NZD', 1, 'invited')`,
  );
}

async function seedInvite(sqlite: SqlJsDatabase) {
  sqlite.run(
    `INSERT INTO contractor_invitation (
      id, business_id, owner_user_id, contractor_id, email, token_digest, status, expires_at, send_count,
      last_sent_at, last_delivery, created_by_user_id, created_at, updated_at
    ) VALUES ('inv-1', 'biz_owner-a', 'owner-a', 'c1', 'aroha@example.test', ?, 'pending', ?, 1, 1700000000, 'email', 'owner-a', 1700000000, 1700000000)`,
    [await invitationTokenDigest(TOKEN), Math.floor(Date.now() / 1000) + 86_400],
  );
}

describe("invitation preview and accept routes", () => {
  let sqlite: SqlJsDatabase;

  beforeEach(async () => {
    session.user = null;
    sqlite = await openPortalSqlite();
    handle.database = portalDatabase(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run("UPDATE business SET name = 'Northwind' WHERE id = 'biz_owner-a'");
    seedContractor(sqlite);
  });

  it("rejects a missing origin before spending the rate limit", async () => {
    const blocked = await previewInvite(post("/api/invitations/preview", { token: TOKEN }, { origin: null }));
    expect(blocked.status).toBe(403);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM rate_limit")).toEqual([[0]]);
    const allowed = await previewInvite(post("/api/invitations/preview", { token: "unknown-token-value-0123456789" }));
    expect(allowed.status).toBe(200);
  });

  it("returns a closed preview with no account details", async () => {
    const response = await previewInvite(post("/api/invitations/preview", { token: "unknown-token-value-0123456789" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ state: "unknown" });
    expect(Object.keys(body as object)).toEqual(["state"]);
  });

  it("previews a new account and accepts it with a Better Auth session", async () => {
    await seedInvite(sqlite);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const preview = await previewInvite(post("/api/invitations/preview", { token: TOKEN }));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({
      state: "ready",
      mode: "setup",
      businessName: "Northwind",
      email: "aroha@example.test",
    });

    const accepted = await acceptInvite(post("/api/invitations/accept", {
      token: TOKEN,
      email: "aroha@example.test",
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    }));
    expect(accepted.status).toBe(200);
    const body = await accepted.json() as { ok: boolean };
    expect(body).toEqual({ ok: true });
    const setCookie = accepted.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Secure-better-auth.session_token=");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(setCookie.split(".", 1)[0]).not.toContain(TOKEN);
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(PASSWORD);
    spy.mockRestore();

    const auth = createAuth({
      secret: workerEnv.BETTER_AUTH_SECRET,
      baseURL: workerEnv.BETTER_AUTH_URL,
      db: handle.database as never,
      trustedOrigins: [ORIGIN],
      secureCookies: true,
    });
    const sessionUser = await auth.api.getSession({ headers: new Headers({ cookie: setCookie.split(";")[0] ?? "" }) });
    expect(sessionUser?.user.email).toBe("aroha@example.test");
    expect(sessionUser?.user.emailVerified).toBe(true);
    sqlite.run("DELETE FROM session");
    const signedIn = await auth.api.signInEmail({
      body: { email: "aroha@example.test", password: PASSWORD },
      headers: new Headers({ origin: ORIGIN }),
    });
    expect(signedIn.user.email).toBe("aroha@example.test");
  }, 30_000);

  it("rejects a mismatched email and rate limits later attempts", async () => {
    await seedInvite(sqlite);
    const mismatch = await acceptInvite(post("/api/invitations/accept", {
      token: TOKEN,
      email: "other@example.test",
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    }, { ip: "203.0.113.20" }));
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toEqual({ error: "email_mismatch" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM user WHERE id != 'owner-a'")).toEqual([[0]]);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await acceptInvite(post("/api/invitations/accept", {
        token: `unknown-token-${attempt}-0123456789ab`,
        email: "other@example.test",
        password: PASSWORD,
        passwordConfirm: PASSWORD,
      }, { ip: "203.0.113.20" }));
      expect(response.status).toBe(400);
    }
    const limited = await acceptInvite(post("/api/invitations/accept", {
      token: "unknown-token-9-0123456789abcd",
      email: "other@example.test",
      password: PASSWORD,
      passwordConfirm: PASSWORD,
    }, { ip: "203.0.113.20" }));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });
    const keys = sqlRows(sqlite, "SELECT key FROM rate_limit").flat().join(" ");
    expect(keys).toContain("invite-accept:203.0.113.20");
    expect(keys).not.toContain(TOKEN);
    expect(keys).not.toContain("unknown-token");
  });

  it("rate limits invitation preview", async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await previewInvite(post("/api/invitations/preview", {
        token: `preview-token-${String(attempt).padStart(2, "0")}-abcdef`,
      }, { ip: "203.0.113.30" }));
      expect(response.status).toBe(200);
    }
    const limited = await previewInvite(post("/api/invitations/preview", {
      token: "preview-token-99-abcdefghij",
    }, { ip: "203.0.113.30" }));
    expect(limited.status).toBe(429);
    const keys = sqlRows(sqlite, "SELECT key FROM rate_limit").flat().join(" ");
    expect(keys).toContain("invite-preview:203.0.113.30");
    expect(keys).not.toContain("preview-token");
  });
});
