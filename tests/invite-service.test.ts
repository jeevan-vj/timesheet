import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";
import { describe, expect, it } from "vitest";
import { hashInviteToken } from "../src/lib/invite-token";
import { acceptInvite, accountRole, createInvite, resendInvite, revokeInvite } from "../src/services/invites";
import { seedOwnerWorkspace } from "./owner-workspace";

const MIGRATIONS = ["0000_initial.sql", "0001_entry_mode.sql", "0002_week_approval.sql", "0003_recurring_schedules.sql", "0004_business_workspace.sql", "0005_ops_audit.sql", "0006_contractor_engagement.sql", "0007_contractor_invites.sql"];
const NOW = new Date("2026-10-22T00:00:00.000Z");
const OLD_TOKEN = "A".repeat(43);
const NEW_TOKEN = "B".repeat(43);

type InviteDb = Parameters<typeof acceptInvite>[0];
type BatchQuery = { run(): unknown };

async function openMemoryDb(beforeBatch?: (sqlite: SqlJsDatabase) => void) {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  for (const name of MIGRATIONS) sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
  const database = drizzle(sqlite) as unknown as InviteDb;
  let hook = beforeBatch;
  (database as unknown as { batch(queries: BatchQuery[]): Promise<Array<{ meta: { changes: number } }>> }).batch = async (queries: BatchQuery[]) => {
    hook?.(sqlite); hook = undefined;
    const results: Array<{ meta: { changes: number } }> = [];
    sqlite.run("BEGIN");
    try {
      for (const query of queries) {
        query.run();
        results.push({ meta: { changes: sqlite.getRowsModified() } });
      }
      sqlite.run("COMMIT");
      return results;
    } catch (error) {
      sqlite.run("ROLLBACK");
      throw error;
    }
  };
  return { sqlite, database: database as InviteDb };
}

function scalar(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []) {
  const statement = sqlite.prepare(sql); statement.bind(params);
  const value = statement.step() ? statement.get()[0] : undefined;
  statement.free(); return value;
}

function seedContractor(sqlite: SqlJsDatabase) {
  seedOwnerWorkspace(sqlite, "owner-a");
  sqlite.run("INSERT INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('user-a','Synthetic Contractor','locked@example.test',0,1700000000,1700000000)");
  sqlite.run("INSERT INTO contractor (id,owner_user_id,business_id,created_at,updated_at,name,email,phone,default_rate_cents,currency,active,engagement_status) VALUES ('contractor-a','owner-a','biz_owner-a',1700000000,1700000000,'Synthetic Contractor','locked@example.test','',3200,'NZD',1,'invited')");
}

async function seedInvite(sqlite: SqlJsDatabase, token = OLD_TOKEN) {
  seedContractor(sqlite);
  sqlite.run("INSERT INTO contractor_invite (id,owner_user_id,business_id,contractor_id,invited_email,token_digest,status,expires_at,created_at,updated_at) VALUES ('invite-a','owner-a','biz_owner-a','contractor-a','locked@example.test',?,'pending',?,1700000000,1700000000)", [await hashInviteToken(token), Math.floor(new Date("2026-10-29T00:00:00.000Z").getTime() / 1000)]);
}

describe("invite compare-and-set transitions", () => {
  it.each(["suspended", "archived"])("does not create an invite over a concurrent %s transition", async (status) => {
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor SET engagement_status=?, active=0 WHERE id='contractor-a'", [status]));
    seedContractor(sqlite);
    await expect(createInvite(database, "owner-a", "contractor-a", NOW)).rejects.toThrow("not_found");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor_invite")).toBe(0);
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id='contractor-a'")).toBe(status);
  });

  it("does not link an old token when resend rotates it between read and commit", async () => {
    const newDigest = await hashInviteToken(NEW_TOKEN);
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor_invite SET token_digest=?, updated_at=updated_at+1 WHERE id='invite-a'", [newDigest]));
    await seedInvite(sqlite);
    await expect(acceptInvite(database, OLD_TOKEN, { id: "user-a", email: "locked@example.test" }, NOW)).rejects.toThrow("invite_unavailable");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor_user")).toBe(0);
    expect(scalar(sqlite, "SELECT token_digest FROM contractor_invite WHERE id='invite-a'")).toBe(newDigest);
    expect(scalar(sqlite, "SELECT engagement_status FROM contractor WHERE id='contractor-a'")).toBe("invited");
  });

  it("does not link when revoke wins between read and commit", async () => {
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor_invite SET status='revoked', revoked_at=?, updated_at=updated_at+1 WHERE id='invite-a'", [Math.floor(NOW.getTime() / 1000)]));
    await seedInvite(sqlite);
    await expect(acceptInvite(database, OLD_TOKEN, { id: "user-a", email: "locked@example.test" }, NOW)).rejects.toThrow("invite_unavailable");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor_user")).toBe(0);
    expect(scalar(sqlite, "SELECT status FROM contractor_invite WHERE id='invite-a'")).toBe("revoked");
  });

  it("allows one acceptance and rejects a double accept without another link", async () => {
    const { sqlite, database } = await openMemoryDb(); await seedInvite(sqlite);
    await acceptInvite(database, OLD_TOKEN, { id: "user-a", email: "LOCKED@example.test" }, NOW);
    await expect(acceptInvite(database, OLD_TOKEN, { id: "user-a", email: "locked@example.test" }, NOW)).rejects.toThrow("invite_unavailable");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor_user")).toBe(1);
    expect(scalar(sqlite, "SELECT status FROM contractor_invite WHERE id='invite-a'")).toBe("accepted");
  });

  it("does not link when the invite expires at commit time", async () => {
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor_invite SET expires_at=? WHERE id='invite-a'", [Math.floor(NOW.getTime() / 1000)]));
    await seedInvite(sqlite);
    await expect(acceptInvite(database, OLD_TOKEN, { id: "user-a", email: "locked@example.test" }, NOW)).rejects.toThrow("invite_unavailable");
    expect(scalar(sqlite, "SELECT COUNT(*) FROM contractor_user")).toBe(0);
  });

  it("does not let resend overwrite an intervening acceptance", async () => {
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor_invite SET status='accepted', accepted_by_user_id='user-a', accepted_at=?, updated_at=updated_at+1 WHERE id='invite-a'", [Math.floor(NOW.getTime() / 1000)]));
    await seedInvite(sqlite);
    await expect(resendInvite(database, "owner-a", "invite-a", NOW)).rejects.toThrow("not_found");
    expect(scalar(sqlite, "SELECT status FROM contractor_invite WHERE id='invite-a'")).toBe("accepted");
  });

  it.each([
    ["email change", "UPDATE contractor SET email='new-address@example.test' WHERE id='contractor-a'"],
    ["suspension", "UPDATE contractor SET engagement_status='suspended', active=0 WHERE id='contractor-a'"],
  ])("does not resend after a concurrent contractor %s", async (_label, statement) => {
    const oldDigest = await hashInviteToken(OLD_TOKEN);
    const { sqlite, database } = await openMemoryDb((raw) => raw.run(statement));
    await seedInvite(sqlite);
    await expect(resendInvite(database, "owner-a", "invite-a", NOW)).rejects.toThrow("not_found");
    expect(scalar(sqlite, "SELECT token_digest FROM contractor_invite WHERE id='invite-a'")).toBe(oldDigest);
  });

  it("does not let revoke overwrite an intervening token rotation", async () => {
    const newDigest = await hashInviteToken(NEW_TOKEN);
    const { sqlite, database } = await openMemoryDb((raw) => raw.run("UPDATE contractor_invite SET token_digest=?, updated_at=updated_at+1 WHERE id='invite-a'", [newDigest]));
    await seedInvite(sqlite);
    await expect(revokeInvite(database, "owner-a", "invite-a", NOW)).rejects.toThrow("not_found");
    expect(scalar(sqlite, "SELECT status FROM contractor_invite WHERE id='invite-a'")).toBe("pending");
    expect(scalar(sqlite, "SELECT token_digest FROM contractor_invite WHERE id='invite-a'")).toBe(newDigest);
  });
});

describe("contractor account role", () => {
  it.each(["invited", "active"])("allows a linked %s contractor", async (status) => {
    const { sqlite, database } = await openMemoryDb(); await seedInvite(sqlite);
    sqlite.run("UPDATE contractor SET engagement_status=?, active=1 WHERE id='contractor-a'", [status]);
    sqlite.run("INSERT INTO contractor_user (id,owner_user_id,business_id,contractor_id,user_id,created_at,updated_at) VALUES ('link-a','owner-a','biz_owner-a','contractor-a','user-a',1700000000,1700000000)");
    expect(await accountRole(database, "user-a")).toBe("contractor");
  });

  it.each(["suspended", "archived"])("denies a linked %s contractor", async (status) => {
    const { sqlite, database } = await openMemoryDb(); await seedInvite(sqlite);
    sqlite.run("UPDATE contractor SET engagement_status=?, active=0 WHERE id='contractor-a'", [status]);
    sqlite.run("INSERT INTO contractor_user (id,owner_user_id,business_id,contractor_id,user_id,created_at,updated_at) VALUES ('link-a','owner-a','biz_owner-a','contractor-a','user-a',1700000000,1700000000)");
    expect(await accountRole(database, "user-a")).toBe("unassigned");
  });
});
