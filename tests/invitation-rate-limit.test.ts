import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));

import type { db } from "../src/db/client";
import { consumeInvitationRate } from "../src/lib/invitation-rate-limit";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

const KEY = "invite-accept:203.0.113.40";
type PortalDb = typeof db;

function seedRate(sqlite: SqlJsDatabase, count: number, now: number) {
  sqlite.run(
    "INSERT INTO rate_limit (id, key, count, last_request) VALUES ('rate-1', ?, ?, ?)",
    [KEY, count, now],
  );
}

function stealNextUpdate(database: PortalDb, sqlite: SqlJsDatabase, count: number) {
  const original = database.update.bind(database);
  let armed = true;
  database.update = ((...args: Parameters<PortalDb["update"]>) => {
    if (armed) {
      armed = false;
      sqlite.run("UPDATE rate_limit SET count = ? WHERE key = ?", [count, KEY]);
    }
    return original(...args);
  }) as PortalDb["update"];
}

describe("invitation rate limit", () => {
  let sqlite: SqlJsDatabase;
  let database: PortalDb;
  const now = 1_700_000_000_000;

  beforeEach(async () => {
    sqlite = await openPortalSqlite();
    database = portalDatabase<PortalDb>(sqlite);
  });

  it("denies the loser of a concurrent increment when the last slot is taken", async () => {
    seedRate(sqlite, 4, now);
    stealNextUpdate(database, sqlite, 5);
    await expect(consumeInvitationRate(database, "accept", "203.0.113.40", now)).resolves.toBe(false);
    expect(sqlRows(sqlite, "SELECT count FROM rate_limit WHERE key = ?", [KEY])).toEqual([[5]]);
  });

  it("retries once when a concurrent increment leaves a free slot", async () => {
    seedRate(sqlite, 3, now);
    stealNextUpdate(database, sqlite, 4);
    await expect(consumeInvitationRate(database, "accept", "203.0.113.40", now)).resolves.toBe(true);
    expect(sqlRows(sqlite, "SELECT count FROM rate_limit WHERE key = ?", [KEY])).toEqual([[5]]);
  });
});
