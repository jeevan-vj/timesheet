import type { Database as SqlJsDatabase } from "sql.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationExistsError } from "../src/lib/invitation-errors";
import { invitationTokenDigest, invitationTokenMatches } from "../src/lib/invitation-token";
import { INVITATION_TTL_MS, RESEND_COOLDOWN_MS } from "../src/lib/invitation-view";
import type { SendEmailInput, SendEmailResult } from "../src/lib/mailer";
import { updateContractor } from "../src/services/timesheet";
import {
  createContractorInvitation,
  getContractorInvitation,
  resendContractorInvitation,
  revokeContractorInvitation,
} from "../src/services/invitations";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

const workerEnv = vi.hoisted(() => ({
  DB: {},
  BETTER_AUTH_SECRET: "test-secret",
  BETTER_AUTH_URL: "https://app.example.test",
  AUTH_TRUSTED_ORIGINS: "",
  RELEASE_SHA: "test",
  EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>",
  RESEND_API_KEY: "",
}));

vi.mock("cloudflare:workers", () => ({ env: workerEnv }));

type Database = Parameters<typeof createContractorInvitation>[0];

const PUBLIC_URL = "https://app.example.test";

function seedContractor(sqlite: SqlJsDatabase, id: string, ownerUserId: string, email: string, status = "active", active = 1) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active, engagement_status
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, ?, '', 3200, 'NZD', ?, ?)`,
    [id, ownerUserId, `biz_${ownerUserId}`, id === "c1" ? "Aroha North" : id, email, active, status],
  );
}

function digests(sqlite: SqlJsDatabase) {
  return sqlRows(sqlite, "SELECT token_digest, email, status, send_count FROM contractor_invitation ORDER BY id");
}

describe("contractor invitations", () => {
  let sqlite: SqlJsDatabase;
  let database: Database;
  let now = new Date("2026-10-20T00:00:00.000Z");
  let tokenIndex = 0;
  const tokens = ["token-one-aaaaaaaa", "token-two-bbbbbbbb", "token-three-cccccc"];
  const sent: SendEmailInput[] = [];
  const send = vi.fn(async (input: SendEmailInput): Promise<SendEmailResult> => {
    sent.push(input);
    return { status: "not_configured" };
  });

  async function open() {
    sqlite = await openPortalSqlite();
    database = portalDatabase<Database>(sqlite);
    seedOwnerWorkspace(sqlite, "owner-a");
    seedOwnerWorkspace(sqlite, "owner-b");
    sqlite.run("UPDATE business SET name = 'Northwind', contact_email = 'office@example.test' WHERE id = 'biz_owner-a'");
    seedContractor(sqlite, "c1", "owner-a", "Aroha@Example.test");
    now = new Date("2026-10-20T00:00:00.000Z");
    tokenIndex = 0;
    sent.length = 0;
    send.mockClear();
  }

  function deps(sendEmail: typeof send | null = send) {
    return {
      now: () => now,
      createId: () => `inv-${tokenIndex}`,
      createToken: () => tokens[tokenIndex++] ?? "token-extra",
      ...(sendEmail ? { sendEmail } : {}),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates one pending invite, sets invited, and does not store the token", async () => {
    await open();
    const created = await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    expect(created.delivery).toBe("link_only");
    expect(created.invitation.state).toBe("pending");
    expect(created.invitation.sendCount).toBe(1);
    expect(new URL(created.inviteLink).hash).toBe("#token-one-aaaaaaaa");
    expect(new URL(created.inviteLink).search).toBe("");
    expect(JSON.stringify(created.invitation)).not.toContain("token-one-aaaaaaaa");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.idempotencyKey).toBe("invite/inv-1/1");
    expect(sent[0]?.to).toBe("aroha@example.test");
    expect(sent[0]?.replyTo).toBe("office@example.test");
    expect(sent[0]?.html).toContain(`href="${created.inviteLink}"`);
    expect(sent[0]?.html).not.toMatch(/\/invite\?/);
    const stored = digests(sqlite);
    expect(stored).toHaveLength(1);
    expect(String(stored[0]?.[0])).toMatch(/^[0-9a-f]{64}$/);
    expect(String(stored[0]?.[0])).not.toContain("token-one");
    expect(stored[0]?.[1]).toBe("aroha@example.test");
    expect(sqlRows(sqlite, "SELECT engagement_status, active FROM contractor WHERE id = 'c1'")).toEqual([["invited", 1]]);
    expect(await invitationTokenMatches("token-one-aaaaaaaa", String(stored[0]?.[0]))).toBe(true);

    await expect(createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps())).rejects.toBeInstanceOf(InvitationExistsError);
    expect(digests(sqlite)).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("rotates the digest on resend, revokes only a pending row, and expires from the clock", async () => {
    await open();
    await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    const original = String(digests(sqlite)[0]?.[0]);
    now = new Date(now.getTime() + INVITATION_TTL_MS);
    expect((await getContractorInvitation(database, "owner-a", "c1", deps())).state).toBe("pending");
    now = new Date(now.getTime() + 1000);
    expect((await getContractorInvitation(database, "owner-a", "c1", deps())).state).toBe("expired");

    const resent = await resendContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    expect(resent.invitation.state).toBe("pending");
    expect(resent.invitation.sendCount).toBe(2);
    expect(sent[1]?.idempotencyKey).toBe("invite/inv-1/2");
    expect(new URL(resent.inviteLink).hash).toBe("#token-two-bbbbbbbb");
    const rotated = String(digests(sqlite)[0]?.[0]);
    expect(rotated).not.toBe(original);
    expect(await invitationTokenMatches("token-one-aaaaaaaa", rotated)).toBe(false);
    expect(await invitationTokenMatches("token-two-bbbbbbbb", rotated)).toBe(true);

    const revoked = await revokeContractorInvitation(database, "owner-a", "c1", deps());
    expect(revoked.invitation.state).toBe("revoked");
    expect(JSON.stringify(revoked)).not.toContain("token-");
    await expect(revokeContractorInvitation(database, "owner-a", "c1", deps())).rejects.toThrow("invitation_not_pending");
    await expect(resendContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps())).rejects.toThrow("invitation_not_pending");
  });

  it("refuses a blank email, an ineligible status, another owner's contractor, and an existing link", async () => {
    await open();
    seedContractor(sqlite, "blank", "owner-a", "", "active", 1);
    seedContractor(sqlite, "drafted", "owner-a", "draft@example.test", "draft", 0);
    await expect(createContractorInvitation(database, "owner-a", "blank", PUBLIC_URL, deps())).rejects.toThrow("contractor_email_required");
    await expect(createContractorInvitation(database, "owner-a", "drafted", PUBLIC_URL, deps())).rejects.toThrow("not_found");
    await expect(createContractorInvitation(database, "owner-b", "c1", PUBLIC_URL, deps())).rejects.toThrow("not_found");
    expect(digests(sqlite)).toHaveLength(0);

    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES ('acct-1', 'biz_owner-a', 'owner-a', 'c1', 'owner-b', 1, 1700000000, 1700000000)`,
    );
    await expect(createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps())).rejects.toThrow("already_linked");
    expect(digests(sqlite)).toHaveLength(0);
  });

  it("revokes a pending invite when the contractor email changes and keeps a case-only change", async () => {
    await open();
    await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    await updateContractor(database, "owner-a", "c1", {
      name: "Aroha North",
      email: "aroha@example.test",
      phone: "",
      defaultRateCents: 3200,
      engagementStatus: "invited",
    });
    expect((await getContractorInvitation(database, "owner-a", "c1", deps())).state).toBe("pending");
    await updateContractor(database, "owner-a", "c1", {
      name: "Aroha North",
      email: "other@example.test",
      phone: "",
      defaultRateCents: 3200,
      engagementStatus: "invited",
    });
    expect((await getContractorInvitation(database, "owner-a", "c1", deps())).state).toBe("revoked");
    expect(sqlRows(sqlite, "SELECT rate_cents FROM time_entry")).toEqual([]);
  });

  it("waits 60 seconds before another resend and drops a resend that lost send_count", async () => {
    await open();
    await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    await expect(resendContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps())).rejects.toThrow("resend_too_soon");
    now = new Date(now.getTime() + RESEND_COOLDOWN_MS - 1);
    await expect(resendContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps())).rejects.toThrow("resend_too_soon");
    expect(sent).toHaveLength(1);
    expect(digests(sqlite)[0]?.[3]).toBe(1);

    now = new Date(now.getTime() + 1);
    const raced = deps();
    raced.createToken = () => {
      sqlite.run("UPDATE contractor_invitation SET send_count = send_count + 1 WHERE contractor_id = 'c1'");
      return "token-stale-should-not-mail";
    };
    await expect(resendContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, raced)).rejects.toThrow("invitation_conflict");
    expect(sent).toHaveLength(1);
    expect(sent.some((input) => input.text.includes("token-stale-should-not-mail"))).toBe(false);
    expect(await invitationTokenMatches("token-one-aaaaaaaa", String(digests(sqlite)[0]?.[0]))).toBe(true);
    expect(digests(sqlite)[0]?.[3]).toBe(2);
  });

  it("records a PII-free failure and still returns the link", async () => {
    await open();
    workerEnv.RESEND_API_KEY = "resend-test-key";
    const fetchImpl = vi.fn(async () => new Response("secret-body", { status: 502 }));
    vi.stubGlobal("fetch", fetchImpl);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const created = await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps(null));
    expect(created.delivery).toBe("email_failed");
    expect(created.invitation.state).toBe("pending");
    expect(created.inviteLink).toContain("#token-one-aaaaaaaa");
    expect(fetchImpl).toHaveBeenCalledOnce();
    const logged = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).not.toContain("token-one-aaaaaaaa");
    expect(logged).not.toContain("aroha@example.test");
    expect(logged).not.toContain("secret-body");
    expect(logged).not.toContain("resend-test-key");
    expect(sqlRows(sqlite, "SELECT last_delivery, status FROM contractor_invitation")).toEqual([["email_failed", "pending"]]);
    spy.mockRestore();
    workerEnv.RESEND_API_KEY = "";
  });

  it("stores the digest that matches the mailed token", async () => {
    await open();
    await createContractorInvitation(database, "owner-a", "c1", PUBLIC_URL, deps());
    const digest = String(digests(sqlite)[0]?.[0]);
    expect(digest).toBe(await invitationTokenDigest("token-one-aaaaaaaa"));
  });
});
