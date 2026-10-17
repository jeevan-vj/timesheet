import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.resolve(here, "../../../..");
export const PORT = process.env.VERIFY_CLEANTRACK_PORT ?? "3017";
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const RELEASE = "verify-cleantrack";
export const PERSIST = path.join(root, ".wrangler/verify-cleantrack");
export const RUN = path.join(root, ".wrangler/verify-cleantrack-run");
export const EVIDENCE = path.join(root, "verify-cleantrack-output");
export const PRODUCTION_HOST = "cleantrack-timesheet.jeevan90wijerathna.workers.dev";

export function assertLocal() {
  const host = new URL(BASE_URL).hostname;
  if (host === PRODUCTION_HOST || host.endsWith(".workers.dev")) {
    throw new Error("Refusing to run against a deployed Worker.");
  }
}

export function pidFile() {
  return path.join(RUN, "pid");
}

export function readPid() {
  const file = pidFile();
  if (!fs.existsSync(file)) return null;
  const pid = Number(fs.readFileSync(file, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function childrenOf(pid) {
  try {
    const out = execFileSync("ps", ["-o", "pid=", "--ppid", String(pid)], { encoding: "utf8" });
    return out.split("\n").map((line) => Number(line.trim())).filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

export function processTree(pid, found = []) {
  for (const child of childrenOf(pid)) {
    found.push(child);
    processTree(child, found);
  }
  return found;
}

function sleep(ms) {
  execFileSync("sleep", [(ms / 1000).toFixed(1)]);
}

export function stopOwned() {
  const pid = readPid();
  if (!pid) return;
  const targets = [...processTree(pid).reverse(), pid];
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const target of targets) {
      if (!alive(target)) continue;
      try {
        process.kill(target, signal);
      } catch {
        // Already gone.
      }
    }
    const deadline = Date.now() + 5_000;
    while (targets.some((target) => alive(target)) && Date.now() < deadline) sleep(200);
    if (!targets.some((target) => alive(target))) break;
  }
  fs.rmSync(pidFile(), { force: true });
}

export function run(command, args) {
  const child = spawn(command, args, { cwd: root, stdio: "inherit" });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

export async function fetchHealth() {
  const response = await fetch(`${BASE_URL}/api/health`, { redirect: "error" });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

export function findSqliteFiles(dir, found = []) {
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findSqliteFiles(full, found);
    else if (entry.name.endsWith(".sqlite")) found.push(full);
  }
  return found;
}

export function countRows() {
  const files = findSqliteFiles(PERSIST);
  let lastError = "Local D1 database has no readable user table.";
  for (const file of files) {
    let database;
    try {
      database = new DatabaseSync(file, { readOnly: true });
      const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'").all();
      if (tables.length === 0) continue;
      const row = database.prepare(`
        SELECT
          (SELECT COUNT(*) FROM user) AS user_count,
          (SELECT COUNT(*) FROM session) AS session_count,
          (SELECT COUNT(*) FROM business) AS business_count
      `).get();
      return {
        user_count: Number(row.user_count),
        session_count: Number(row.session_count),
        business_count: Number(row.business_count),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    } finally {
      database?.close();
    }
  }
  throw new Error(lastError);
}
