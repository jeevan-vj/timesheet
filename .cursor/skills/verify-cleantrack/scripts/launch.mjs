import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { prepareVerifyEnv, wranglerDevArgs } from "./dev-vars.mjs";
import {
  assertLocal,
  BASE_URL,
  fetchHealth,
  PERSIST,
  pidFile,
  PORT,
  RELEASE,
  root,
  RUN,
  run,
  stopOwned,
} from "./lib.mjs";

assertLocal();
fs.mkdirSync(RUN, { recursive: true });
stopOwned();
fs.rmSync(PERSIST, { recursive: true, force: true });

const { envFile } = prepareVerifyEnv({ rootDir: root, runDir: RUN, baseUrl: BASE_URL });

if (!fs.existsSync(path.join(root, "dist/server/wrangler.json"))) {
  await run("pnpm", ["build"]);
}
fs.rmSync(path.join(root, "dist/server/.dev.vars"), { force: true });

await run("pnpm", [
  "exec", "wrangler", "d1", "migrations", "apply", "cleantrack-timesheet",
  "--local", "--config", "wrangler.jsonc", "--persist-to", PERSIST,
]);

const logPath = path.join(RUN, "server.log");
const log = fs.openSync(logPath, "w");
const child = spawn("pnpm", wranglerDevArgs({
  port: PORT,
  persist: PERSIST,
  release: RELEASE,
  baseUrl: BASE_URL,
  envFile,
}), { cwd: root, detached: true, stdio: ["ignore", log, log] });
child.unref();
fs.closeSync(log);
fs.writeFileSync(pidFile(), `${child.pid}\n`);

const deadline = Date.now() + 90_000;
let last = "health not ready";
while (Date.now() < deadline) {
  try {
    const health = await fetchHealth();
    if (health.status === 200 && health.body.status === "ok" && health.body.database === "ok" && health.body.release === RELEASE) {
      process.stdout.write(`ready ${BASE_URL}\n`);
      process.exit(0);
    }
    last = `health ${health.status} ${health.body.status ?? ""} ${health.body.release ?? ""}`;
  } catch (error) {
    last = error instanceof Error ? error.message : "health request failed";
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
process.stderr.write(`App did not become ready at ${BASE_URL}: ${last}\n`);
if (fs.existsSync(logPath)) process.stderr.write(fs.readFileSync(logPath, "utf8").slice(-4000));
process.exit(1);
