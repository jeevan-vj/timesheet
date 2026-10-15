import fs from "node:fs";
import path from "node:path";
import type { Database as SqlJsDatabase } from "sql.js";

const SEEDED_AT = 1_700_000_000;

export function execBusinessMigration(sqlite: SqlJsDatabase) {
  sqlite.exec(fs.readFileSync(path.resolve("drizzle/0004_business_workspace.sql"), "utf8"));
}

export function seedOwnerWorkspace(sqlite: SqlJsDatabase, userId: string, profile?: { name?: string; email?: string }) {
  const name = profile?.name ?? userId;
  const email = profile?.email ?? `${userId}@example.test`;
  sqlite.run(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)",
    [userId, name, email, SEEDED_AT, SEEDED_AT],
  );
  sqlite.run(
    `INSERT INTO business (
      id, name, nzbn, address, contact_email, contact_phone, timezone, currency, week_start,
      onboarding_completed_at, created_at, updated_at
    ) VALUES (?, ?, '', '', ?, '', 'Pacific/Auckland', 'NZD', 'monday', NULL, ?, ?)`,
    [`biz_${userId}`, name, email, SEEDED_AT, SEEDED_AT],
  );
  sqlite.run(
    `INSERT INTO business_member (id, business_id, user_id, role, active, created_at, updated_at)
     VALUES (?, ?, ?, 'owner', 1, ?, ?)`,
    [`mem_${userId}`, `biz_${userId}`, userId, SEEDED_AT, SEEDED_AT],
  );
}
