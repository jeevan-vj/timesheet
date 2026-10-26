import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveViewer } from "../src/lib/viewer";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase } from "./portal-db";

const session = vi.hoisted(() => ({
  user: { id: "owner-a", email: "owner-a@example.test", name: "Owner A" } as { id: string; email: string; name: string } | null,
}));

const handle = vi.hoisted(() => ({ database: null as unknown }));

vi.mock("cloudflare:workers", () => ({
  env: {
    DB: { prepare: vi.fn() },
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "https://app.example.test",
    AUTH_TRUSTED_ORIGINS: "",
    RELEASE_SHA: "test",
    EMAIL_FROM: "CleanTrack <invites@jnok.co.nz>",
  },
}));
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

import { GET as readMe } from "../src/app/api/me/route";

type Database = Parameters<typeof resolveViewer>[0];

function cookieRequest() {
  return new Request("https://app.example.test/api/me", {
    headers: { cookie: "better-auth.session_token=test", origin: "https://app.example.test" },
  });
}

function seedContractor(sqlite: SqlJsDatabase, id: string, ownerUserId: string) {
  sqlite.run(
    `INSERT INTO contractor (
      id, owner_user_id, business_id, created_at, updated_at, name, email, phone, default_rate_cents, currency, active
    ) VALUES (?, ?, ?, 1700000000, 1700000000, ?, '', '', 3200, 'NZD', 1)`,
    [id, ownerUserId, `biz_${ownerUserId}`, id],
  );
}

describe("GET /api/me", () => {
  let sqlite: SqlJsDatabase;
  let database: Database;

  beforeEach(async () => {
    session.user = { id: "owner-a", email: "owner-a@example.test", name: "Owner A" };
    sqlite = await openPortalSqlite();
    database = portalDatabase<Database>(sqlite);
    handle.database = database;
    seedOwnerWorkspace(sqlite, "owner-a", { name: "Northwind", email: "office@example.test" });
    seedOwnerWorkspace(sqlite, "owner-b", { name: "Harbour", email: "harbour@example.test" });
    sqlite.run("UPDATE business SET name = 'Northwind' WHERE id = 'biz_owner-a'");
    sqlite.run("UPDATE business SET name = 'Harbour' WHERE id = 'biz_owner-b'");
  });

  it("returns 401 when signed out", async () => {
    session.user = null;
    const response = await readMe(cookieRequest());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns the owner profile and no contractor links until an account exists", async () => {
    const response = await readMe(cookieRequest());
    expect(response.status).toBe(200);
    const body = await response.json() as { owner: { id: string; name: string } | null; contractorOf: unknown[] };
    expect(body.owner).toMatchObject({ id: "biz_owner-a", name: "Northwind" });
    expect(body.contractorOf).toEqual([]);
    expect(body).not.toHaveProperty("ownerUserId");
  });

  it("lists active contractor links for a user who is not an owner", async () => {
    seedOwnerWorkspace(sqlite, "owner-c", { name: "Alpha", email: "alpha@example.test" });
    sqlite.run("UPDATE business SET name = 'Alpha' WHERE id = 'biz_owner-c'");
    seedContractor(sqlite, "c1", "owner-a");
    seedContractor(sqlite, "c2", "owner-b");
    seedContractor(sqlite, "c3", "owner-c");
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('contractor-1', 'Aroha', 'aroha@example.test', 0, 1700000000, 1700000000)",
    );
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES ('acct-1', 'biz_owner-b', 'owner-b', 'c2', 'contractor-1', 1, 1700000000, 1700000000)`,
    );
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES ('acct-2', 'biz_owner-a', 'owner-a', 'c1', 'contractor-1', 1, 1700000000, 1700000000)`,
    );
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, revoked_at, created_at, updated_at
      ) VALUES ('acct-old', 'biz_owner-c', 'owner-c', 'c3', 'contractor-1', 0, 1700000000, 1700000000, 1700000000)`,
    );

    const viewer = await resolveViewer(database, "contractor-1");
    expect(viewer.owner).toBeNull();
    expect(viewer.contractorOf).toEqual([
      { businessId: "biz_owner-b", businessName: "Harbour" },
      { businessId: "biz_owner-a", businessName: "Northwind" },
    ]);
  });
});
