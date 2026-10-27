import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const DESTRUCTIVE_LABEL = "migration-destructive-ok";
export const MARKER_PATH = ".github/migration-destructive-ok.txt";
const MIGRATION_NAME = /^\d{4,}[_-][\w.-]+\.sql$/;

export const OPT_IN_HELP = [
  "A pending migration contains destructive SQL (DROP TABLE, DROP COLUMN, DROP INDEX, TRUNCATE, DELETE FROM without WHERE, or a table rebuild).",
  "The release stops until that file is explicitly approved.",
  "Prefer a per-file opt-in. Add its basename, one per line, to " + MARKER_PATH + ".",
  `The ${DESTRUCTIVE_LABEL} label on the merged pull request opts in every pending destructive migration in that release, not one file.`,
  "A merge-commit trailer approves one file: Migration-Destructive-Ok: <basename>.sql",
  "The marker file is the durable record. The label and the trailer approve one release.",
  "This check does not edit migrations and it does not restore D1.",
].join("\n");

export function assertMigrationName(name) {
  if (typeof name !== "string" || !MIGRATION_NAME.test(name)) {
    throw new Error("Unexpected migration name from wrangler");
  }
  return name;
}

export function stripSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''");
}

export function detectDestructiveSql(sql) {
  const cleaned = stripSql(sql);
  const reasons = [];
  if (/\bDROP\s+TABLE\b/i.test(cleaned)) reasons.push("DROP TABLE");
  if (/\bDROP\s+COLUMN\b/i.test(cleaned)) reasons.push("DROP COLUMN");
  if (/\bDROP\s+INDEX\b/i.test(cleaned)) reasons.push("DROP INDEX");
  if (/\bTRUNCATE\b/i.test(cleaned)) reasons.push("TRUNCATE");
  if (hasDeleteWithoutWhere(cleaned)) reasons.push("DELETE FROM");
  if (isTableRebuild(cleaned)) reasons.push("table rebuild");
  return reasons;
}

function hasDeleteWithoutWhere(sql) {
  for (const statement of sql.split(";")) {
    if (!/\bDELETE\s+FROM\b/i.test(statement)) continue;
    if (!/\bWHERE\b/i.test(statement)) return true;
  }
  return false;
}

function isTableRebuild(sql) {
  const creates = sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi);
  for (const match of creates) {
    const name = match[1];
    if (!name.endsWith("_new") && !name.startsWith("__new_")) continue;
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const copy = sql.match(new RegExp(
      `INSERT\\s+INTO\\s+[\`"]?${quoted}[\`"]?[\\s\\S]*?\\bSELECT\\b[\\s\\S]*?\\bFROM\\b\\s+[\`"]?([A-Za-z0-9_]+)[\`"]?`,
      "i",
    ));
    if (!copy) continue;
    const source = copy[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const dropsSource = new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?[\`"]?${source}[\`"]?`, "i").test(sql);
    const renames = new RegExp(`\\bALTER\\s+TABLE\\s+[\`"]?${quoted}[\`"]?\\s+RENAME\\s+TO\\s+[\`"]?${source}[\`"]?`, "i").test(sql);
    if (dropsSource && renames) return true;
  }
  return false;
}

export function pendingMigrationNames(listOutput) {
  const marker = "Migrations to be applied:";
  const from = listOutput.indexOf(marker);
  if (from >= 0) {
    const section = listOutput.slice(from + marker.length);
    return [...new Set([...section.matchAll(/\b(\d{4,}[_-][\w.-]+\.sql)\b/g)].map((match) => assertMigrationName(match[1])))];
  }
  if (/No migrations to apply!/i.test(listOutput)) return [];
  throw new Error("Could not read pending migrations from wrangler d1 migrations list");
}

export function parseMarker(text) {
  const names = new Set();
  for (const line of text.split("\n")) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;
    names.add(assertMigrationName(trimmed));
  }
  return names;
}

export function parseTrailers(message) {
  const names = new Set();
  for (const line of message.split("\n")) {
    const match = line.match(/^Migration-Destructive-Ok:\s*(\S+)\s*$/i);
    if (match) names.add(assertMigrationName(match[1]));
  }
  return names;
}

export function unapprovedDestructiveMigrations({ pending, readSql, markerNames, trailerNames, labels }) {
  const labelApproved = labels.includes(DESTRUCTIVE_LABEL);
  const blocked = [];
  for (const name of pending) {
    const reasons = detectDestructiveSql(readSql(name));
    if (reasons.length === 0) continue;
    if (labelApproved || markerNames.has(name) || trailerNames.has(name)) continue;
    blocked.push({ name, reasons });
  }
  return blocked;
}

export function formatBlockedMigrations(blocked) {
  const lines = blocked.map((item) => `- ${item.name}: ${item.reasons.join(", ")}`);
  return `${lines.join("\n")}\n\n${OPT_IN_HELP}`;
}

export async function labelsForCommit({ repository, sha, token, fetchImpl }) {
  if (!repository || !sha || !token) throw new Error("GitHub label lookup is not configured");
  const response = await fetchImpl(`https://api.github.com/repos/${repository}/commits/${sha}/pulls`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "cleantrack-release",
    },
  });
  if (!response.ok) throw new Error(`GitHub label lookup failed with HTTP ${response.status}`);
  const pulls = await response.json();
  if (!Array.isArray(pulls)) throw new Error("GitHub label lookup returned an unexpected payload");
  return pulls.flatMap((pull) => (
    Array.isArray(pull.labels)
      ? pull.labels.map((label) => label?.name).filter((name) => typeof name === "string")
      : []
  ));
}

function redact(text) {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?token|secret|password|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 500);
}

function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const failure = new Error(`${args.join(" ")} failed: ${redact(stderr || stdout || "")}`);
        reject(failure);
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function readPendingSql(name) {
  assertMigrationName(name);
  const file = path.join(repoRoot, "drizzle", name);
  if (path.dirname(file) !== path.join(repoRoot, "drizzle")) throw new Error("Unexpected migration path");
  return fs.readFileSync(file, "utf8");
}

async function gitCommitMessage() {
  const { stdout } = await execFileText("git", ["log", "-1", "--format=%B"]);
  return stdout;
}

async function listPending() {
  const { stdout, stderr } = await execFileText("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "list",
    "cleantrack-timesheet",
    "--remote",
    "--config",
    "wrangler.jsonc",
  ]);
  return pendingMigrationNames(`${stdout}\n${stderr}`);
}

export async function enforceDestructiveMigrationGuard({
  listPendingImpl = listPending,
  readSql = readPendingSql,
  markerText = fs.existsSync(path.join(repoRoot, MARKER_PATH)) ? fs.readFileSync(path.join(repoRoot, MARKER_PATH), "utf8") : "",
  commitMessage = gitCommitMessage,
  labels,
  fetchImpl = fetch,
  env = process.env,
  logger = console,
} = {}) {
  const pending = await listPendingImpl();
  const markerNames = parseMarker(markerText);
  const message = typeof commitMessage === "function" ? await commitMessage() : commitMessage;
  const trailerNames = parseTrailers(message);
  let resolvedLabels = labels ?? [];
  let blocked = unapprovedDestructiveMigrations({
    pending,
    readSql,
    markerNames,
    trailerNames,
    labels: resolvedLabels,
  });
  if (blocked.length > 0 && labels === undefined) {
    try {
      resolvedLabels = await labelsForCommit({
        repository: env.GITHUB_REPOSITORY,
        sha: env.GITHUB_SHA,
        token: env.GITHUB_TOKEN,
        fetchImpl,
      });
    } catch (error) {
      logger.error(error instanceof Error ? error.message : "GitHub label lookup failed");
      logger.error(formatBlockedMigrations(blocked));
      throw new Error("Destructive migrations are not approved and the pull request label could not be read");
    }
    blocked = unapprovedDestructiveMigrations({
      pending,
      readSql,
      markerNames,
      trailerNames,
      labels: resolvedLabels,
    });
  }
  if (blocked.length > 0) {
    logger.error(formatBlockedMigrations(blocked));
    throw new Error("Unapproved destructive migrations");
  }
  logger.log(`Destructive migration check passed (${pending.length} pending)`);
}

async function main() {
  await enforceDestructiveMigrationGuard();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Destructive migration check failed");
    process.exitCode = 1;
  });
}
