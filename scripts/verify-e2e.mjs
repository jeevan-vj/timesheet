import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertSafeBaseUrl } from "../tests/e2e/safety.mjs";
import { runOwnerFlow } from "../tests/e2e/owner-flow.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function parseArgs(argv) {
  const args = { out: "verify-e2e-output", port: "8788", startApp: false, build: false, headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--start-app") args.startApp = true;
    else if (arg === "--build") args.build = true;
    else if (arg === "--headed") args.headed = true;
    else if (arg.startsWith("--") && next && !next.startsWith("--")) {
      args[arg.slice(2)] = next;
      index += 1;
    }
  }
  return args;
}

function write(line) {
  process.stdout.write(`${line}\n`);
}

async function waitForHealth(baseUrl, timeoutMs = 120_000) {
  const started = Date.now();
  let lastError = "health not ready";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(new URL("/api/health", baseUrl), { redirect: "error" });
      if (response.ok) {
        const body = await response.json();
        if (body.status === "ok" && body.database === "ok") return body;
        lastError = `health ${response.status}`;
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

function runCommand(command, args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: "1", ...env }, stdio: "inherit" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`))));
  });
}

function writeDevVars(cwd, baseUrl) {
  const secret = process.env.BETTER_AUTH_SECRET || "local-development-secret-change-me-123456789";
  const contents = `BETTER_AUTH_SECRET=${secret}\nBETTER_AUTH_URL=${baseUrl}\nAUTH_TRUSTED_ORIGINS=${baseUrl}\n`;
  fs.writeFileSync(path.join(cwd, ".dev.vars"), contents);
  const distDir = path.join(cwd, "dist", "server");
  if (fs.existsSync(distDir)) fs.writeFileSync(path.join(distDir, ".dev.vars"), contents);
}

async function startLocalApp({ cwd, port, build }) {
  const baseUrl = assertSafeBaseUrl(`http://127.0.0.1:${port}`);
  const distConfig = path.join(cwd, "dist", "server", "wrangler.json");
  if (build || !fs.existsSync(distConfig)) {
    write("Building the local worker.");
    await runCommand("pnpm", ["build"], { cwd });
  }
  const persist = path.join(cwd, ".wrangler", "verify-e2e-state");
  fs.rmSync(persist, { recursive: true, force: true });
  writeDevVars(cwd, baseUrl);
  await runCommand("pnpm", [
    "exec", "wrangler", "d1", "migrations", "apply", "cleantrack-timesheet",
    "--local", "--config", "wrangler.jsonc", "--persist-to", persist,
  ], { cwd });
  const logPath = path.join(cwd, "verify-e2e-output", "server.log");
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, "w");
  const child = spawn("pnpm", [
    "exec", "wrangler", "dev",
    "--config", "dist/server/wrangler.json",
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--persist-to", persist,
    "--var", `BETTER_AUTH_URL:${baseUrl}`,
    "--var", `AUTH_TRUSTED_ORIGINS:${baseUrl}`,
    "--var", "RELEASE_SHA:verify-e2e-local",
  ], {
    cwd,
    env: { ...process.env, CI: "1" },
    detached: true,
    stdio: ["ignore", log, log],
  });
  try {
    await waitForHealth(baseUrl);
    return { baseUrl, child };
  } catch (error) {
    stopChild(child);
    throw error;
  }
}

function stopChild(child) {
  if (!child?.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

function publicRoster(roster, week) {
  return {
    week,
    ownerBusiness: roster.owner.business,
    otherBusiness: roster.otherOwner.business,
    sites: roster.sites.map((site) => site.name),
    contractors: roster.contractors.map((contractor) => ({
      name: contractor.name,
      defaultRateCents: contractor.defaultRateCents,
      snapshotRateCents: contractor.snapshotRateCents,
      paidMinutes: contractor.paidMinutes,
      payCents: contractor.payCents,
      occurrences: contractor.occurrences,
    })),
    totals: roster.totals,
    siteTotals: roster.siteTotals,
  };
}

function renderReport(report) {
  const lines = [
    "# CleanTrack local end-to-end evidence",
    "",
    `Observed at ${report.timestamp} against \`${report.baseUrl}\`.`,
    `Head \`${report.headSha}\`. This file records what the browser run observed. It is not a product sign-off.`,
    "",
    "## Steps",
    "",
    "| Step | Result | What was observed |",
    "| --- | --- | --- |",
  ];
  for (const step of report.steps) {
    const detail = String(step.detail ?? "").replaceAll("|", "/").replaceAll("\n", " ");
    lines.push(`| \`${step.id}\` | ${step.status} | ${detail} |`);
  }
  lines.push("", "## Fixture", "");
  lines.push("Synthetic names only. Pay is `round(paidMinutes × rateCents / 60)` per entry, then summed.");
  lines.push("");
  lines.push(`Week \`${report.fixture.week}\`. Total ${report.fixture.totals.paidMinutes} minutes and ${report.fixture.totals.payCents} cents.`);
  lines.push("");
  lines.push("| Contractor | Default cents | Snapshotted cents | Minutes | Pay cents |");
  lines.push("| --- | ---: | ---: | ---: | ---: |");
  for (const contractor of report.fixture.contractors) {
    lines.push(`| ${contractor.name} | ${contractor.defaultRateCents} | ${contractor.snapshotRateCents} | ${contractor.paidMinutes} | ${contractor.payCents} |`);
  }
  lines.push("", "## Screenshots", "");
  for (const step of report.steps) {
    for (const file of step.screenshots ?? []) lines.push(`- \`${step.id}\`: ${file}`);
  }
  const bugs = report.steps.filter((step) => step.status === "fail");
  lines.push("", "## Bugs", "");
  if (!bugs.length) lines.push("No product bug was observed in the implementable steps.");
  else {
    for (const bug of bugs) lines.push(`- \`${bug.id}\`: ${bug.detail}`);
  }
  const blocked = report.steps.filter((step) => step.status === "not_implemented" || step.status === "blocked");
  lines.push("", "## Not implemented", "");
  if (!blocked.length) lines.push("None.");
  else {
    for (const step of blocked) {
      const issues = (step.issues ?? []).map((issue) => issue).join(", ");
      lines.push(`- \`${step.id}\` (${step.status})${issues ? `: ${issues}` : ""}. ${step.detail}`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function copyEvidence(outDir, evidenceDir) {
  fs.rmSync(evidenceDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(evidenceDir, "screenshots"), { recursive: true });
  fs.copyFileSync(path.join(outDir, "REPORT.md"), path.join(evidenceDir, "REPORT.md"));
  fs.copyFileSync(path.join(outDir, "report.json"), path.join(evidenceDir, "report.json"));
  const shots = path.join(outDir, "screenshots");
  if (fs.existsSync(shots)) {
    for (const file of fs.readdirSync(shots)) {
      if (file.endsWith(".png")) fs.copyFileSync(path.join(shots, file), path.join(evidenceDir, "screenshots", file));
    }
  }
}

async function launchBrowser(headed) {
  const { chromium } = await import("playwright");
  try {
    return await chromium.launch({ headless: !headed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/executable|browserType/i.test(message)) throw error;
    write("Installing Playwright Chromium.");
    await runCommand("pnpm", ["exec", "playwright", "install", "chromium"], { cwd: repoRoot });
    return chromium.launch({ headless: !headed });
  }
}

export async function runVerification(options) {
  const cwd = options.cwd ?? repoRoot;
  const outDir = path.resolve(cwd, options.out ?? "verify-e2e-output");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });
  let app;
  let baseUrl = options.baseUrl ? assertSafeBaseUrl(options.baseUrl) : "";
  if (options.startApp) {
    app = await startLocalApp({ cwd, port: options.port ?? "8788", build: options.build });
    baseUrl = app.baseUrl;
  }
  if (!baseUrl) throw new Error("Pass --base-url or --start-app.");
  baseUrl = assertSafeBaseUrl(baseUrl);
  await waitForHealth(baseUrl);

  const browser = await launchBrowser(options.headed);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  let flow;
  try {
    flow = await runOwnerFlow({ page, baseUrl, screenshotDir: path.join(outDir, "screenshots") });
  } finally {
    await browser.close();
    stopChild(app?.child);
  }

  const headSha = options.headSha || "unknown";
  const failing = flow.results.some((step) => step.status === "fail" || step.status === "blocked");
  const report = {
    baseUrl,
    headSha,
    timestamp: new Date().toISOString(),
    environment: "local-d1",
    steps: flow.results,
    fixture: publicRoster(flow.roster, flow.week),
    overall: failing ? "fail" : "pass",
  };
  fs.writeFileSync(path.join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(outDir, "REPORT.md"), renderReport(report));
  if (options.evidence) copyEvidence(outDir, path.resolve(cwd, options.evidence));
  return { report, outDir };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let headSha = "unknown";
  try {
    const { execSync } = await import("node:child_process");
    headSha = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    headSha = "unknown";
  }
  const result = await runVerification({
    cwd: repoRoot,
    out: args.out,
    port: args.port,
    startApp: args.startApp,
    build: args.build,
    headed: args.headed,
    baseUrl: args["base-url"] || process.env.VERIFY_E2E_BASE_URL || "",
    evidence: args.evidence,
    headSha,
  });
  for (const step of result.report.steps) write(`${step.status.padEnd(16)} ${step.id}`);
  write(`overall ${result.report.overall}`);
  write(`report ${path.join(result.outDir, "REPORT.md")}`);
  if (result.report.overall !== "pass") process.exitCode = 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
