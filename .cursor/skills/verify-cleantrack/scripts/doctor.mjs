import { execFileSync } from "node:child_process";
import { alive, assertLocal, BASE_URL, fetchHealth, PORT, processTree, readPid, RELEASE } from "./lib.mjs";

assertLocal();
const pid = readPid();
if (!pid || !alive(pid)) {
  process.stderr.write("doctor: launch process is not running\n");
  process.exit(1);
}

const health = await fetchHealth();
if (health.status !== 200 || health.body.status !== "ok" || health.body.database !== "ok") {
  process.stderr.write(`doctor: health is not ok (${health.status})\n`);
  process.exit(1);
}
if (health.body.release !== RELEASE) {
  process.stderr.write(`doctor: release is ${health.body.release ?? "missing"}, expected ${RELEASE}\n`);
  process.exit(1);
}

const owned = new Set([pid, ...processTree(pid)]);
let listeners = "";
try {
  listeners = execFileSync("ss", ["-ltnp"], { encoding: "utf8" });
} catch {
  listeners = "";
}
const portLine = listeners.split("\n").find((line) => line.includes(`:${PORT}`) && line.includes("LISTEN"));
if (!portLine) {
  process.stderr.write(`doctor: nothing is listening on ${PORT}\n`);
  process.exit(1);
}
const listenerPids = [...portLine.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1]));
if (listenerPids.length > 0 && !listenerPids.some((listener) => owned.has(listener))) {
  process.stderr.write(`doctor: port ${PORT} is not owned by the launch process\n`);
  process.exit(1);
}

const dashboard = await fetch(`${BASE_URL}/api/dashboard`, { redirect: "error" });
const dashboardBody = await dashboard.json().catch(() => ({}));
if (dashboard.status !== 401 || dashboardBody.error !== "unauthorized") {
  process.stderr.write(`doctor: anonymous dashboard returned ${dashboard.status}\n`);
  process.exit(1);
}

process.stdout.write(`doctor ok ${BASE_URL} release=${health.body.release} pid=${pid}\n`);
