import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadPlan } from "../evaluate-e2e-evidence.mjs";
import { sanitizeConsoleEntry, sanitizeNetworkEntry } from "./sanitize.mjs";

export const DEFAULT_PLAN_IDS = ["health-ok", "owner-signup", "empty-week-dashboard"];

const PASSWORD = "CleanTrackE2Epass1";

function parseArgs(argv) {
  const out = { out: "factory-e2e-output", startApp: false, port: "8787" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--start-app") out.startApp = true;
    else if (arg.startsWith("--") && next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function envOrArg(args, key, envKeys) {
  if (args[key]) return args[key];
  for (const name of envKeys) {
    if (process.env[name]) return process.env[name];
  }
  return "";
}

async function waitForHealth(baseUrl, timeoutMs = 90_000) {
  const started = Date.now();
  let lastError = "health not ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(new URL("/api/health", baseUrl), { redirect: "error" });
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" && body.database === "ok") return body;
        lastError = `health ${response.status} ${body.status ?? ""}`;
      } else {
        lastError = `health ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : "health request failed";
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`App did not become healthy at ${baseUrl}: ${lastError}`);
}

function writeDevVars(cwd, baseUrl) {
  const secret = process.env.BETTER_AUTH_SECRET || "local-development-secret-change-me-123456789";
  const contents = [
    `BETTER_AUTH_SECRET=${secret}`,
    `BETTER_AUTH_URL=${baseUrl}`,
    `AUTH_TRUSTED_ORIGINS=${baseUrl}`,
    "",
  ].join("\n");
  fs.writeFileSync(path.join(cwd, ".dev.vars"), contents);
  const distDir = path.join(cwd, "dist", "server");
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, ".dev.vars"), contents);
}

function spawnLogged(command, args, { cwd, extraEnv = {} } = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function startLocalApp({ cwd, port }) {
  const baseUrl = `http://127.0.0.1:${port}`;
  const persist = path.join(cwd, ".wrangler", "e2e-state");
  writeDevVars(cwd, baseUrl);
  await new Promise((resolve, reject) => {
    const migrate = spawnLogged("pnpm", [
      "exec", "wrangler", "d1", "migrations", "apply", "cleantrack-timesheet",
      "--local", "--config", "wrangler.jsonc", "--persist-to", persist,
    ], { cwd });
    migrate.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`d1 migrate exited ${code}`))));
  });
  const child = spawnLogged("pnpm", [
    "exec", "wrangler", "dev",
    "--config", "dist/server/wrangler.json",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--persist-to", persist,
    "--var", `BETTER_AUTH_URL:${baseUrl}`,
    "--var", `AUTH_TRUSTED_ORIGINS:${baseUrl}`,
    "--var", "RELEASE_SHA:factory-e2e",
  ], { cwd });
  try {
    await waitForHealth(baseUrl);
    return { baseUrl, child };
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
}

async function runScenarios({ page, baseUrl, headSha, screenshotDir }) {
  const email = `e2e.${headSha.slice(0, 10)}.${Date.now()}@example.test`;
  const results = [];
  const shot = async (id) => {
    const relative = `screenshots/${id}.png`;
    await page.screenshot({ path: path.join(screenshotDir, `${id}.png`), fullPage: true });
    return relative;
  };

  const run = async (id, fn) => {
    try {
      const screenshots = await fn();
      results.push({ id, status: "pass", screenshots });
    } catch (error) {
      let screenshots = [`screenshots/${id}.png`];
      try {
        screenshots = [await shot(`${id}-failure`)];
      } catch {
        screenshots = [];
      }
      results.push({
        id,
        status: "fail",
        screenshots: screenshots.length ? screenshots : [`screenshots/${id}.png`],
        error: error instanceof Error ? error.message : "scenario_failed",
      });
    }
  };

  await run("health-ok", async () => {
    const response = await page.request.get(new URL("/api/health", baseUrl).toString());
    const body = await response.json().catch(() => ({}));
    if (!response.ok() || body.status !== "ok" || body.database !== "ok") {
      throw new Error(`health check failed (${response.status()})`);
    }
    await page.goto(new URL("/api/health", baseUrl).toString(), { waitUntil: "networkidle" });
    return [await shot("health-ok")];
  });

  await run("owner-signup", async () => {
    await page.goto(new URL("/sign-up", baseUrl).toString(), { waitUntil: "networkidle" });
    await page.getByLabel("Your name").fill("Factory E2E Owner");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await page.waitForURL(/\/dashboard(?:\/|$|\?)/, { timeout: 30_000 });
    await page.getByRole("heading", { name: "Hours & contractor pay" }).waitFor({ timeout: 30_000 });
    await page.getByText("No shifts this week").waitFor({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    return [await shot("owner-signup")];
  });

  await run("empty-week-dashboard", async () => {
    await page.waitForLoadState("networkidle");
    await page.goto(new URL("/dashboard", baseUrl).toString(), { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Hours & contractor pay" }).waitFor({ timeout: 30_000 });
    await page.getByText("No shifts this week").waitFor({ timeout: 30_000 });
    await page.waitForLoadState("networkidle");
    return [await shot("empty-week-dashboard")];
  });

  return results;
}

export async function runHarness(options = {}) {
  const outDir = path.resolve(options.out ?? "factory-e2e-output");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });

  const repository = options.repository;
  const prNumber = Number(options.prNumber);
  const headSha = options.headSha;
  const plan = options.plan ?? loadPlan();
  if (plan.scenarios.map((item) => item.id).join() !== DEFAULT_PLAN_IDS.join()) {
    throw new Error("Harness plan must stay on the trusted default owner-path scenarios");
  }

  let app;
  let baseUrl = options.baseUrl;
  if (options.startApp) {
    app = await startLocalApp({ cwd: options.cwd ?? process.cwd(), port: options.port ?? "8787" });
    baseUrl = app.baseUrl;
  }
  if (!baseUrl) throw new Error("baseUrl is required");
  await waitForHealth(baseUrl, options.healthTimeoutMs ?? 90_000);

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const consoleEntries = [];
  const networkEntries = [];
  context.on("console", (msg) => {
    consoleEntries.push(sanitizeConsoleEntry({ type: msg.type(), text: msg.text() }));
  });
  context.on("pageerror", (error) => {
    consoleEntries.push(sanitizeConsoleEntry({ type: "error", text: error.message }));
  });
  context.on("requestfailed", (request) => {
    networkEntries.push(sanitizeNetworkEntry({
      method: request.method(),
      url: request.url(),
      failed: true,
      failure: request.failure()?.errorText ?? "requestfailed",
    }));
  });
  context.on("response", (response) => {
    if (response.status() >= 400) {
      networkEntries.push(sanitizeNetworkEntry({
        method: response.request().method(),
        url: response.url(),
        status: response.status(),
        failed: false,
      }));
    }
  });

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  const page = await context.newPage();
  let scenarios = [];
  try {
    scenarios = await runScenarios({
      page,
      baseUrl,
      headSha,
      screenshotDir: path.join(outDir, "screenshots"),
    });
  } finally {
    await context.tracing.stop({ path: path.join(outDir, "trace.zip") });
    await browser.close();
    app?.child?.kill("SIGTERM");
  }

  fs.writeFileSync(path.join(outDir, "console.json"), `${JSON.stringify(consoleEntries, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "network.json"), `${JSON.stringify(networkEntries, null, 2)}\n`);

  const failed = scenarios.filter((item) => item.status !== "pass");
  const report = {
    schemaVersion: "1",
    repository,
    prNumber,
    headSha,
    run: {
      workflow: "Factory E2E Evidence",
      workflowRunId: String(options.runId ?? process.env.GITHUB_RUN_ID ?? "local"),
      job: "Factory E2E evidence",
      event: String(options.event ?? process.env.GITHUB_EVENT_NAME ?? "local"),
    },
    timestamp: new Date().toISOString(),
    app: { baseUrl, environment: "factory-local-worker" },
    scenarios,
    artifacts: {
      trace: "trace.zip",
      console: "console.json",
      network: "network.json",
      screenshots: scenarios.flatMap((item) => item.screenshots ?? []),
    },
    console: {
      errors: consoleEntries.filter((item) => item.type === "error"),
      warnings: consoleEntries.filter((item) => item.type === "warning"),
    },
    network: { failures: networkEntries },
    checks: [],
    overallVerdict: failed.length ? "fail" : "pass",
    reasonCodes: failed.length ? ["scenario_failed"] : [],
  };
  fs.writeFileSync(path.join(outDir, "e2e-evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { report, outDir };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runHarness({
    out: args.out,
    startApp: args.startApp,
    port: args.port,
    cwd: args.cwd,
    baseUrl: envOrArg(args, "base-url", ["FACTORY_E2E_BASE_URL"]),
    repository: envOrArg(args, "repository", ["FACTORY_E2E_REPOSITORY", "GITHUB_REPOSITORY"]),
    prNumber: envOrArg(args, "pr", ["FACTORY_E2E_PR"]),
    headSha: envOrArg(args, "head-sha", ["FACTORY_E2E_HEAD_SHA"]),
    runId: process.env.GITHUB_RUN_ID,
    event: process.env.GITHUB_EVENT_NAME,
  });
  if (result.report.overallVerdict !== "pass") {
    console.error("Factory E2E scenarios failed.");
    process.exitCode = 1;
  }
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
