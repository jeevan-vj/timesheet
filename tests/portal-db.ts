import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/sql-js";
import initSqlJs, { type Database as SqlJsDatabase } from "sql.js";

const MIGRATIONS = [
  "0000_initial.sql",
  "0001_entry_mode.sql",
  "0002_week_approval.sql",
  "0003_recurring_schedules.sql",
  "0004_business_workspace.sql",
  "0005_ops_audit.sql",
  "0006_contractor_engagement.sql",
  "0007_contractor_portal_access.sql",
  "0008_account_provider_key.sql",
] as const;

export async function openPortalSqlite(): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs();
  const sqlite = new SQL.Database();
  for (const name of MIGRATIONS) sqlite.exec(fs.readFileSync(path.resolve("drizzle", name), "utf8"));
  return sqlite;
}

export function portalDatabase<T>(sqlite: SqlJsDatabase): T {
  return drizzle(sqlite) as unknown as T;
}

export function sqlRows(sqlite: SqlJsDatabase, sql: string, params: Array<string | number | null> = []): unknown[][] {
  const statement = sqlite.prepare(sql);
  statement.bind(params);
  const rows: unknown[][] = [];
  while (statement.step()) rows.push(statement.get());
  statement.free();
  return rows;
}
