import { spawn } from "node:child_process";
import process from "node:process";

const appBaseUrl = "http://localhost:3000";
const mailpitUrl = "http://127.0.0.1:8025";
const childEnvironment = {
  ...process.env,
  EMAIL_PROVIDER: "mailpit",
  EMAIL_FROM: "noreply@example.test",
  MAILPIT_URL: mailpitUrl,
  APP_BASE_URL: appBaseUrl,
  BETTER_AUTH_URL: appBaseUrl,
  WRANGLER_LOG_PATH: "/private/tmp/cleantrack-invites-wrangler.log",
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", env: childEnvironment, ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${code ?? signal})`)));
  });
}

async function waitFor(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

await waitFor(`${mailpitUrl}/api/v1/info`, 5_000);
await run("node_modules/.bin/wrangler", ["d1", "migrations", "apply", "cleantrack-timesheet", "--local"]);

function redactInvitePaths(chunk) {
  return chunk.toString().replace(/(\/(?:api\/)?invites?\/)[A-Za-z0-9_-]{43}/g, "$1[redacted]");
}

const server = spawn("node_modules/.bin/vinext", ["dev", "--hostname", "localhost", "--port", "3000"], { stdio: ["inherit", "pipe", "pipe"], env: childEnvironment });
server.stdout.on("data", (chunk) => process.stdout.write(redactInvitePaths(chunk)));
server.stderr.on("data", (chunk) => process.stderr.write(redactInvitePaths(chunk)));
let stopping = false;
function stopServer() {
  if (stopping) return;
  stopping = true;
  server.kill("SIGTERM");
}
process.on("SIGINT", () => { stopServer(); process.exitCode = 130; });
process.on("SIGTERM", () => { stopServer(); process.exitCode = 143; });

try {
  await waitFor(`${appBaseUrl}/api/health`, 180_000);
  await run(process.execPath, ["tests/e2e/invites.e2e.mjs"]);
} finally {
  stopServer();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
