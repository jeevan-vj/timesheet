import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import type { db } from "../src/db/client";
import { invitationTokenDigest } from "../src/lib/invitation-token";
import { createAuth } from "../src/lib/auth-options";
import { acceptInvitation, previewInvitation, type AcceptInput } from "../src/services/invitation-accept";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

const TOKEN = "invite-token-value-0123456789abcdef";
const PASSWORD = "cleaner-pass-123456";
const NOW = new Date(Date.now() + 86_400_000);
const FUTURE = Math.floor(NOW.getTime() / 1000) + 86_400;
const PAST = Math.floor(NOW.getTime() / 1000) - 86_400;

type PortalDb = typeof db;

function setBatch(database: PortalDb, batch: (queries: readonly unknown[]) => Promise<void>) {
  (database as unknown as { batch: typeof batch }).batch = batch;
}

function hashPassword(password: string): Promise<string> {
  return Promise.resolve(`hash:${password}`);
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return hash === `hash:${password}`;
}

function ids() {
  let count = 0;
  return () => {
    count += 1;
    return `id-${count}`;
  };
}

function seedContractor(sqlite: SqlJsDatabase, engagement = "invited", email = "aroha@example.test", active = 1) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
    ) VALUES ('c1', 'owner-a', 'biz_owner-a', 1700000000, 1700000000, 'Aroha North', ?, '', 3200, 'NZD', ?, ?)`,
    [email, active, engagement],
  );
}

async function seedInvite(sqlite: SqlJsDatabase, status = "pending", expires = FUTURE, email = "aroha@example.test") {
  const digest = await invitationTokenDigest(TOKEN);
  sqlite.run(
    `INSERT INTO contractor_invitation (
      id, business_id, owner_user_id, contractor_id, email, token_digest, status, expires_at, send_count,
      last_sent_at, last_delivery, created_by_user_id, created_at, updated_at, accepted_user_id
    ) VALUES ('inv-1', 'biz_owner-a', 'owner-a', 'c1', ?, ?, ?, ?, 1, 1700000000, 'email', 'owner-a', 1700000000, 1700000000, NULL)`,
    [email, digest, status, expires],
  );
  return digest;
}

function acceptInput(overrides: Partial<AcceptInput> = {}): AcceptInput {
  return {
    token: TOKEN,
    email: "aroha@example.test",
    password: PASSWORD,
    passwordConfirm: PASSWORD,
    session: null,
    secret: "test-secret",
    baseURL: "https://app.example.test",
    secureCookies: true,
    ipAddress: "127.0.0.1",
    userAgent: "vitest",
    ...overrides,
  };
}

describe("invitation accept", () => {
  let sqlite: SqlJsDatabase;
  let database: PortalDb;
  let batches: number[];

  beforeEach(async () => {
    sqlite = await openPortalSqlite();
    database = portalDatabase<PortalDb>(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    sqlite.run("UPDATE business SET name = 'Northwind' WHERE id = 'biz_owner-a'");
    seedContractor(sqlite);
    batches = [];
    setBatch(database, async (queries) => {
      batches.push(queries.length);
      for (const query of queries) await query;
    });
  });

  it("creates a verified credential account, link, and session in one batch", async () => {
    const digest = await seedInvite(sqlite);
    const result = await acceptInvitation(database, acceptInput(), {
      now: () => NOW,
      createId: ids(),
      hashPassword,
      verifyPassword,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.setCookie).toContain("__Secure-better-auth.session_token=");
    expect(result.setCookie).toContain("HttpOnly");
    expect(result.setCookie).toContain("Secure");
    expect(batches).toEqual([6]);
    expect(sqlRows(sqlite, "SELECT email, email_verified, name FROM user WHERE email = 'aroha@example.test'")).toEqual([
      ["aroha@example.test", 1, "Aroha North"],
    ]);
    expect(sqlRows(sqlite, "SELECT issuer, provider_id, account_id = user_id, password FROM account")).toEqual([
      ["local:credential", "credential", 1, `hash:${PASSWORD}`],
    ]);
    expect(sqlRows(sqlite, "SELECT user_id, active FROM contractor_account")).toEqual([["id-1", 1]]);
    expect(sqlRows(sqlite, "SELECT status, accepted_user_id FROM contractor_invitation")).toEqual([["accepted", "id-1"]]);
    expect(sqlRows(sqlite, "SELECT engagement_status, active FROM contractor")).toEqual([["active", 1]]);
    const dumped = new TextDecoder().decode(sqlite.export());
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).toContain(digest);
    expect(result.setCookie).not.toContain(TOKEN);

    const auth = createAuth({
      secret: "test-secret",
      baseURL: "https://app.example.test",
      db: database,
      trustedOrigins: ["https://app.example.test"],
      secureCookies: true,
    });
    const cookie = result.setCookie?.split(";")[0] ?? "";
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe("aroha@example.test");
    expect(session?.user.emailVerified).toBe(true);
  });

  it("reissues a session for the same password and rejects a different one", async () => {
    await seedInvite(sqlite);
    const deps = { now: () => NOW, createId: ids(), hashPassword, verifyPassword };
    const first = await acceptInvitation(database, acceptInput(), deps);
    expect(first.ok).toBe(true);
    const second = await acceptInvitation(database, acceptInput(), deps);
    expect(second.ok).toBe(true);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM user WHERE email = 'aroha@example.test'")).toEqual([[1]]);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM session")).toEqual([[2]]);
    const wrong = await acceptInvitation(database, acceptInput({ password: "other-pass-123456", passwordConfirm: "other-pass-123456" }), deps);
    expect(wrong).toEqual({ ok: false, error: "used" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM session")).toEqual([[2]]);
  });

  it("does not create an account for a closed or mismatched invite", async () => {
    await seedInvite(sqlite, "pending", PAST);
    const expired = await acceptInvitation(database, acceptInput(), { now: () => NOW, hashPassword });
    expect(expired).toEqual({ ok: false, error: "expired" });

    sqlite.run("DELETE FROM contractor_invitation");
    await seedInvite(sqlite, "revoked");
    const revoked = await acceptInvitation(database, acceptInput(), { now: () => NOW, hashPassword });
    expect(revoked).toEqual({ ok: false, error: "revoked" });

    const unknown = await acceptInvitation(database, acceptInput({
      token: "unknown-token-value-0123456789",
      email: "someone@example.test",
    }), { now: () => NOW, hashPassword });
    expect(unknown).toEqual({ ok: false, error: "unknown" });

    sqlite.run("DELETE FROM contractor_invitation");
    await seedInvite(sqlite);
    const mismatch = await acceptInvitation(database, acceptInput({ email: "other@example.test" }), { now: () => NOW, hashPassword });
    expect(mismatch).toEqual({ ok: false, error: "email_mismatch" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM user WHERE id != 'owner-a'")).toEqual([[0]]);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM contractor_account")).toEqual([[0]]);
  });

  it("refuses a different signed-in user and an existing password", async () => {
    await seedInvite(sqlite);
    const mismatch = await acceptInvitation(database, acceptInput({
      session: { id: "other-user", email: "other@example.test" },
      password: null,
      passwordConfirm: null,
    }), { now: () => NOW, hashPassword });
    expect(mismatch).toEqual({ ok: false, error: "account_mismatch" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM contractor_account")).toEqual([[0]]);

    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-1', 'Aroha', 'aroha@example.test', 1, 1700000000, 1700000000)",
    );
    sqlite.run(
      "INSERT INTO account (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at) VALUES ('acct-1', 'user-1', 'local:credential', 'user-1', 'credential', 'hash:kept-pass-123456', 1700000000, 1700000000)",
    );
    const existing = await acceptInvitation(database, acceptInput(), { now: () => NOW, hashPassword, verifyPassword });
    expect(existing).toEqual({ ok: false, error: "sign_in_required" });
    expect(sqlRows(sqlite, "SELECT password FROM account")).toEqual([["hash:kept-pass-123456"]]);

    const signedIn = await acceptInvitation(database, acceptInput({
      session: { id: "user-1", email: "aroha@example.test" },
      password: null,
      passwordConfirm: null,
    }), { now: () => NOW, createId: ids(), hashPassword });
    expect(signedIn).toEqual({ ok: true, setCookie: null });
    expect(sqlRows(sqlite, "SELECT status, accepted_user_id FROM contractor_invitation")).toEqual([["accepted", "user-1"]]);
    expect(sqlRows(sqlite, "SELECT engagement_status FROM contractor")).toEqual([["active"]]);
  });

  it("repairs a passwordless user and writes nothing when the invite is revoked first", async () => {
    await seedInvite(sqlite);
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-1', 'Aroha', 'aroha@example.test', 0, 1700000000, 1700000000)",
    );
    const repaired = await acceptInvitation(database, acceptInput(), {
      now: () => NOW,
      createId: ids(),
      hashPassword,
      verifyPassword,
    });
    expect(repaired.ok).toBe(true);
    expect(sqlRows(sqlite, "SELECT email_verified, password FROM user JOIN account ON account.user_id = user.id")).toEqual([
      [1, `hash:${PASSWORD}`],
    ]);

    sqlite.run("DELETE FROM session");
    sqlite.run("DELETE FROM contractor_account");
    sqlite.run("DELETE FROM account");
    sqlite.run("DELETE FROM user WHERE id = 'user-1'");
    sqlite.run("UPDATE contractor_invitation SET status = 'pending', accepted_user_id = NULL, accepted_at = NULL");
    sqlite.run("UPDATE contractor SET engagement_status = 'invited', active = 1");
    setBatch(database, async (queries) => {
      sqlite.run("UPDATE contractor_invitation SET status = 'revoked'");
      for (const query of queries) await query;
    });
    const lost = await acceptInvitation(database, acceptInput(), {
      now: () => NOW,
      createId: ids(),
      hashPassword,
    });
    expect(lost).toEqual({ ok: false, error: "revoked" });
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM user WHERE id != 'owner-a'")).toEqual([[0]]);
  });

  it("asks an existing account to sign in when the email appears during the write", async () => {
    await seedInvite(sqlite);
    setBatch(database, async () => {
      sqlite.run(
        "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-1', 'Aroha', 'aroha@example.test', 1, 1700000000, 1700000000)",
      );
      sqlite.run(
        "INSERT INTO account (id, user_id, issuer, account_id, provider_id, password, created_at, updated_at) VALUES ('acct-1', 'user-1', 'local:credential', 'user-1', 'credential', 'hash:kept-pass-123456', 1700000000, 1700000000)",
      );
      throw Object.assign(new Error("UNIQUE constraint failed: user.email"), { cause: new Error("UNIQUE constraint failed: user.email") });
    });
    const result = await acceptInvitation(database, acceptInput(), { now: () => NOW, hashPassword, verifyPassword });
    expect(result).toEqual({ ok: false, error: "sign_in_required" });
    expect(sqlRows(sqlite, "SELECT password FROM account")).toEqual([["hash:kept-pass-123456"]]);
  });

  it("previews setup, sign-in, mismatch, and closed states without the token", async () => {
    await seedInvite(sqlite);
    const ready = await previewInvitation(database, { token: TOKEN, session: null }, { now: () => NOW });
    expect(ready).toEqual({ state: "ready", mode: "setup", businessName: "Northwind", email: "aroha@example.test" });
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('user-1', 'Aroha', 'aroha@example.test', 1, 1700000000, 1700000000)",
    );
    const signIn = await previewInvitation(database, { token: TOKEN, session: null }, { now: () => NOW });
    expect(signIn).toMatchObject({ state: "ready", mode: "sign_in" });
    const mismatch = await previewInvitation(database, { token: TOKEN, session: { email: "other@example.test" } }, { now: () => NOW });
    expect(mismatch).toMatchObject({ state: "ready", mode: "mismatch", signedInEmail: "other@example.test" });
    const unknown = await previewInvitation(database, { token: "unknown-token-value-0123456789", session: null }, { now: () => NOW });
    expect(unknown).toEqual({ state: "unknown" });
    expect(JSON.stringify(unknown)).not.toContain("aroha@example.test");
  });
});
