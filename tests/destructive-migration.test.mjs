import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  DESTRUCTIVE_LABEL,
  detectDestructiveSql,
  enforceDestructiveMigrationGuard,
  formatBlockedMigrations,
  labelsForCommit,
  OPT_IN_HELP,
  parseMarker,
  parseTrailers,
  pendingMigrationNames,
  unapprovedDestructiveMigrations,
} from "../.github/scripts/destructive-migration.mjs";

const rebuild = fs.readFileSync(path.resolve("drizzle/0008_account_provider_key.sql"), "utf8");
const additive = fs.readFileSync(path.resolve("drizzle/0005_ops_audit.sql"), "utf8");

function readSql(name) {
  const files = {
    "0008_account_provider_key.sql": rebuild,
    "0009_drop_column.sql": "ALTER TABLE contractor DROP COLUMN phone;",
    "0010_safe.sql": additive,
  };
  return files[name];
}

describe("destructive migration detector", () => {
  it("flags DROP TABLE, DROP COLUMN, DROP INDEX, TRUNCATE, DELETE FROM without WHERE, and the account table rebuild", () => {
    expect(detectDestructiveSql(rebuild)).toEqual(["DROP TABLE", "DROP INDEX", "table rebuild"]);
    expect(detectDestructiveSql("ALTER TABLE site DROP COLUMN address;")).toEqual(["DROP COLUMN"]);
    expect(detectDestructiveSql("DROP TABLE IF EXISTS week_approval;")).toEqual(["DROP TABLE"]);
    expect(detectDestructiveSql("DROP INDEX account_issuer_account_id_uq;")).toEqual(["DROP INDEX"]);
    expect(detectDestructiveSql("TRUNCATE TABLE time_entry;")).toEqual(["TRUNCATE"]);
    expect(detectDestructiveSql("DELETE FROM site;")).toEqual(["DELETE FROM"]);
    expect(detectDestructiveSql("DELETE FROM site WHERE id = 'x';")).toEqual([]);
    expect(detectDestructiveSql("DELETE FROM site WHERE id = 'x';\nDELETE FROM contractor;")).toEqual(["DELETE FROM"]);
    expect(detectDestructiveSql(additive)).toEqual([]);
    expect(detectDestructiveSql("SELECT 'DROP TABLE site' AS label;")).toEqual([]);
    expect(detectDestructiveSql("SELECT 'DELETE FROM site' AS label;")).toEqual([]);
    expect(detectDestructiveSql("-- DROP INDEX site_name\nCREATE INDEX site_name ON site (name);")).toEqual([]);
    expect(detectDestructiveSql("FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE cascade")).toEqual([]);
  });

  it("reads only the pending table from wrangler list output", () => {
    const listed = [
      '[{"name":"0008_account_provider_key.sql"}]',
      "Migrations to be applied:",
      "│ 0009_drop_column.sql │",
      "│ 0010_safe.sql │",
    ].join("\n");
    expect(pendingMigrationNames(listed)).toEqual(["0009_drop_column.sql", "0010_safe.sql"]);
    expect(pendingMigrationNames("Migrations applied. ✅ No migrations to apply!")).toEqual([]);
    expect(() => pendingMigrationNames("wrangler failed")).toThrow(/Could not read pending migrations/);
  });

  it("approves a named file from the marker or commit trailer and a release from the label", () => {
    const pending = ["0008_account_provider_key.sql", "0009_drop_column.sql", "0010_safe.sql"];
    const blocked = unapprovedDestructiveMigrations({
      pending,
      readSql,
      markerNames: parseMarker("# note\n0008_account_provider_key.sql\n"),
      trailerNames: parseTrailers("Release\n\nMigration-Destructive-Ok: 0009_drop_column.sql\n"),
      labels: [],
    });
    expect(blocked).toEqual([]);

    const unlabeled = unapprovedDestructiveMigrations({
      pending: ["0009_drop_column.sql"],
      readSql,
      markerNames: new Set(),
      trailerNames: new Set(),
      labels: [],
    });
    expect(unlabeled).toEqual([{ name: "0009_drop_column.sql", reasons: ["DROP COLUMN"] }]);
    expect(formatBlockedMigrations(unlabeled)).toContain(OPT_IN_HELP);
    expect(formatBlockedMigrations(unlabeled)).toContain(DESTRUCTIVE_LABEL);

    const labeled = unapprovedDestructiveMigrations({
      pending: ["0009_drop_column.sql", "0008_account_provider_key.sql"],
      readSql,
      markerNames: new Set(),
      trailerNames: new Set(),
      labels: [DESTRUCTIVE_LABEL],
    });
    expect(labeled).toEqual([]);
  });

  it("reads pull request labels without printing the response", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify([
      { labels: [{ name: DESTRUCTIVE_LABEL }, { name: "factory:ready" }] },
    ]), { status: 200 }));

    await expect(labelsForCommit({
      repository: "jeevan-vj/timesheet",
      sha: "a".repeat(40),
      token: "github-token",
      fetchImpl,
    })).resolves.toEqual([DESTRUCTIVE_LABEL, "factory:ready"]);

    expect(fetchImpl.mock.calls[0][0]).toBe(`https://api.github.com/repos/jeevan-vj/timesheet/commits/${"a".repeat(40)}/pulls`);
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer github-token");
  });

  it("fails closed when a destructive file is pending and the label API is down", async () => {
    const logger = { error: vi.fn(), log: vi.fn() };
    await expect(enforceDestructiveMigrationGuard({
      listPendingImpl: async () => ["0009_drop_column.sql"],
      readSql,
      markerText: "",
      commitMessage: "Merge",
      fetchImpl: async () => new Response("nope", { status: 500 }),
      env: { GITHUB_REPOSITORY: "jeevan-vj/timesheet", GITHUB_SHA: "b".repeat(40), GITHUB_TOKEN: "token" },
      logger,
    })).rejects.toThrow("Destructive migrations are not approved");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("0009_drop_column.sql"));
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("token");
  });

  it("keeps the committed marker from approving the account rebuild by comment", () => {
    const marker = fs.readFileSync(".github/migration-destructive-ok.txt", "utf8");
    expect([...parseMarker(marker)]).toEqual([]);
  });

  it("passes when the pending file is listed in the marker", async () => {
    const logger = { error: vi.fn(), log: vi.fn() };
    await enforceDestructiveMigrationGuard({
      listPendingImpl: async () => ["0010_safe.sql"],
      readSql,
      markerText: "",
      commitMessage: "Merge",
      labels: [],
      logger,
    });
    expect(logger.log).toHaveBeenCalledWith("Destructive migration check passed (1 pending)");
  });
});
