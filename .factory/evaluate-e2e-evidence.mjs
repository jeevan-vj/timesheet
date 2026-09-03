import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikePng, looksLikeZip, redactSecrets, sanitizeNetworkEntry } from "./e2e/sanitize.mjs";

export const EVIDENCE_SCHEMA_VERSION = "1";
export const E2E_WORKFLOW_NAME = "Factory E2E Evidence";
export const E2E_JOB_NAME = "Factory E2E evidence";
export const E2E_WORKFLOW_PATH = ".github/workflows/factory-e2e.yml";
export const EVIDENCE_REPORT_FILE = "e2e-evidence.json";

export const REASON = {
  MISSING_REPORT: "missing_report",
  MALFORMED_REPORT: "malformed_report",
  SCHEMA_INVALID: "schema_invalid",
  WRONG_REPOSITORY: "wrong_repository",
  WRONG_PR: "wrong_pr",
  STALE_SHA: "stale_sha",
  RUN_FAILED: "run_failed",
  RUN_CANCELLED: "run_cancelled",
  MISSING_RUN: "missing_run",
  UNTRUSTED_WORKFLOW: "untrusted_workflow",
  MISSING_SCREENSHOT: "missing_screenshot",
  MISSING_TRACE: "missing_trace",
  MISSING_CONSOLE: "missing_console",
  MISSING_NETWORK: "missing_network",
  SCENARIO_FAILED: "scenario_failed",
  MISSING_SCENARIO: "missing_scenario",
  CONSOLE_ERROR: "console_error",
  CONSOLE_WARNING: "console_warning",
  NETWORK_FAILURE: "network_failure",
  UNKNOWN_STATE: "unknown_state",
};

const SHA_RE = /^[0-9a-f]{40}$/;

export function loadPlan(planPath = new URL("./e2e/plan.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(planPath, "utf8"));
}

export function loadPolicy(policyPath = new URL("./e2e/policy.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(policyPath, "utf8"));
}

export function loadEvidenceSchema(schemaPath = new URL("./schemas/e2e-evidence.schema.json", import.meta.url)) {
  return JSON.parse(fs.readFileSync(schemaPath, "utf8"));
}

export function artifactNameForSha(headSha) {
  return `factory-e2e-evidence-${headSha}`;
}

export function selectTrustedE2eRun(runs, live = {}) {
  if (!Array.isArray(runs)) {
    return { run: null, reasonCodes: [REASON.UNKNOWN_STATE] };
  }
  const matching = runs
    .filter((run) => String(run?.name ?? "") === E2E_WORKFLOW_NAME)
    .filter((run) => !live.headSha || run?.head_sha === live.headSha)
    .filter((run) => !run?.path || run.path === E2E_WORKFLOW_PATH)
    .sort((a, b) => String(b?.updated_at ?? "").localeCompare(String(a?.updated_at ?? "")));
  const latest = matching[0] ?? null;
  if (!latest) return { run: null, reasonCodes: [REASON.MISSING_RUN] };
  return { run: latest, reasonCodes: [] };
}

export function selectEvidenceArtifact(artifacts, live = {}) {
  if (!Array.isArray(artifacts)) {
    return { artifact: null, reasonCodes: [REASON.UNKNOWN_STATE] };
  }
  const expectedName = live.headSha ? artifactNameForSha(live.headSha) : null;
  const matching = artifacts
    .filter((item) => (expectedName ? item?.name === expectedName : String(item?.name ?? "").startsWith("factory-e2e-evidence-")))
    .filter((item) => !item?.expired)
    .sort((a, b) => String(b?.updated_at ?? b?.created_at ?? "").localeCompare(String(a?.updated_at ?? a?.created_at ?? "")));
  const artifact = matching[0] ?? null;
  if (!artifact) return { artifact: null, reasonCodes: [REASON.MISSING_RUN] };
  const runPath = artifact.workflow_run?.path ?? artifact.path;
  if (runPath && runPath !== E2E_WORKFLOW_PATH) {
    return { artifact: null, reasonCodes: [REASON.UNTRUSTED_WORKFLOW] };
  }
  return { artifact, reasonCodes: [] };
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function readFileEntry(files, relativePath) {
  if (!relativePath) return null;
  const normalized = String(relativePath).replace(/^[./]+/, "");
  if (!files || typeof files !== "object") return null;
  return files[relativePath] ?? files[normalized] ?? files[`./${normalized}`] ?? null;
}

function normalizeArtifactFiles(files = {}) {
  if (readFileEntry(files, EVIDENCE_REPORT_FILE)) return files;
  const reportKey = Object.keys(files).find((key) => key === EVIDENCE_REPORT_FILE || key.endsWith(`/${EVIDENCE_REPORT_FILE}`));
  if (!reportKey) return files;
  const prefix = reportKey.slice(0, -EVIDENCE_REPORT_FILE.length);
  const out = {};
  for (const [key, value] of Object.entries(files)) {
    out[key.startsWith(prefix) ? key.slice(prefix.length) : key] = value;
  }
  return out;
}

function fileBuffer(entry) {
  if (entry == null) return null;
  if (Buffer.isBuffer(entry)) return entry;
  if (typeof entry === "string") return Buffer.from(entry);
  if (Buffer.isBuffer(entry?.buffer)) return entry.buffer;
  if (typeof entry?.text === "string") return Buffer.from(entry.text);
  return null;
}

function fileText(entry) {
  if (entry == null) return null;
  if (typeof entry === "string") return entry;
  if (typeof entry?.text === "string") return entry.text;
  const buffer = fileBuffer(entry);
  return buffer ? buffer.toString("utf8") : null;
}

function isIsoTimestamp(value) {
  if (typeof value !== "string" || !value) return false;
  const time = Date.parse(value);
  return Number.isFinite(time);
}

export function validateReportShape(report, schema = loadEvidenceSchema()) {
  const reasons = [];
  if (report == null) return { ok: false, reasonCodes: [REASON.MISSING_REPORT] };
  if (!asObject(report)) return { ok: false, reasonCodes: [REASON.MALFORMED_REPORT] };

  const required = schema.required ?? [];
  for (const key of required) {
    if (report[key] === undefined) reasons.push(REASON.SCHEMA_INVALID);
  }
  if (report.schemaVersion !== (schema.properties?.schemaVersion?.const ?? EVIDENCE_SCHEMA_VERSION)) {
    reasons.push(REASON.SCHEMA_INVALID);
  }
  if (typeof report.repository !== "string" || !report.repository.includes("/")) reasons.push(REASON.SCHEMA_INVALID);
  if (!Number.isInteger(report.prNumber) || report.prNumber < 1) reasons.push(REASON.SCHEMA_INVALID);
  if (!SHA_RE.test(String(report.headSha ?? ""))) reasons.push(REASON.SCHEMA_INVALID);
  if (!asObject(report.run) || !report.run.workflow || !report.run.workflowRunId || !report.run.job || !report.run.event) {
    reasons.push(REASON.SCHEMA_INVALID);
  }
  if (!isIsoTimestamp(report.timestamp)) reasons.push(REASON.SCHEMA_INVALID);
  if (!asObject(report.app) || !report.app.baseUrl || !report.app.environment) reasons.push(REASON.SCHEMA_INVALID);
  if (looksSecret(report.app?.baseUrl) || looksSecret(report.app?.environment)) reasons.push(REASON.SCHEMA_INVALID);
  if (!Array.isArray(report.scenarios) || report.scenarios.length < 1) reasons.push(REASON.SCHEMA_INVALID);
  if (!asObject(report.artifacts) || !report.artifacts.trace || !report.artifacts.console || !report.artifacts.network) {
    reasons.push(REASON.SCHEMA_INVALID);
  }
  if (!asObject(report.console) || !Array.isArray(report.console.errors) || !Array.isArray(report.console.warnings)) {
    reasons.push(REASON.SCHEMA_INVALID);
  }
  if (!asObject(report.network) || !Array.isArray(report.network.failures)) reasons.push(REASON.SCHEMA_INVALID);
  if (!Array.isArray(report.reasonCodes)) reasons.push(REASON.SCHEMA_INVALID);
  if (!["pass", "fail"].includes(report.overallVerdict)) reasons.push(REASON.SCHEMA_INVALID);

  return { ok: reasons.length === 0, reasonCodes: [...new Set(reasons)] };
}

function looksSecret(value) {
  return /BETTER_AUTH_SECRET|CLOUDFLARE_API_TOKEN|CURSOR_API_KEY|Bearer\s+[A-Za-z0-9._\-+=/]{12,}/i.test(String(value ?? ""));
}

function allowlisted(allowlist, haystack) {
  const text = String(haystack ?? "");
  return (allowlist ?? []).some((rule) => {
    const pattern = typeof rule === "string" ? rule : rule?.pattern;
    if (!pattern) return false;
    try {
      return new RegExp(pattern).test(text);
    } catch {
      return false;
    }
  });
}

function evaluateConsole(rawConsole, policy) {
  const reasons = [];
  const failOn = new Set(policy?.console?.failOn ?? ["error", "warning"]);
  const allowlist = policy?.console?.allowlist ?? [];
  const entries = Array.isArray(rawConsole) ? rawConsole : [];
  for (const entry of entries) {
    const type = String(entry?.type ?? "");
    const text = redactSecrets(entry?.text ?? "");
    if (allowlisted(allowlist, text)) continue;
    if (type === "error" && failOn.has("error")) reasons.push(REASON.CONSOLE_ERROR);
    if (type === "warning" && failOn.has("warning")) reasons.push(REASON.CONSOLE_WARNING);
  }
  return [...new Set(reasons)];
}

function evaluateNetwork(rawNetwork, policy) {
  const reasons = [];
  const allowlist = policy?.network?.allowlist ?? [];
  const failOnFailed = policy?.network?.failOnFailedRequests !== false;
  const failFrom = Number.isInteger(policy?.network?.failOnStatusFrom) ? policy.network.failOnStatusFrom : 400;
  const entries = Array.isArray(rawNetwork) ? rawNetwork : [];
  for (const entry of entries.map(sanitizeNetworkEntry)) {
    const haystack = `${entry.method} ${entry.url} ${entry.status ?? ""}`;
    if (allowlisted(allowlist, haystack)) continue;
    if (failOnFailed && entry.failed) reasons.push(REASON.NETWORK_FAILURE);
    if (Number.isInteger(entry.status) && entry.status >= failFrom) reasons.push(REASON.NETWORK_FAILURE);
  }
  return [...new Set(reasons)];
}

function parseJsonFile(entry, missingCode, malformedCode) {
  const text = fileText(entry);
  if (text == null || text.trim() === "") return { value: null, reasonCodes: [missingCode] };
  try {
    return { value: JSON.parse(text), reasonCodes: [] };
  } catch {
    return { value: null, reasonCodes: [malformedCode] };
  }
}

export function evaluateE2eEvidence({
  live = {},
  run = {},
  files: inputFiles = {},
  plan = loadPlan(),
  policy = loadPolicy(),
  schema = loadEvidenceSchema(),
} = {}) {
  const files = normalizeArtifactFiles(inputFiles);
  const reasonCodes = [];
  const checks = [];
  const add = (id, ok, code) => {
    checks.push({ id, status: ok ? "pass" : "fail" });
    if (!ok && code) reasonCodes.push(code);
  };

  const conclusion = String(run?.conclusion ?? "").toLowerCase();
  const status = String(run?.status ?? "").toLowerCase();
  if (!run || (!run.conclusion && !run.status && !run.id && !run.workflowRunId)) {
    return gateResult("fail", [REASON.UNKNOWN_STATE], checks);
  }
  if (status === "in_progress" || status === "queued") {
    return gateResult("fail", [REASON.UNKNOWN_STATE], checks, { action: "wait" });
  }
  if (["cancelled", "canceled", "timed_out", "skipped"].includes(conclusion)) {
    return gateResult("fail", [REASON.RUN_CANCELLED], checks);
  }
  if (conclusion && conclusion !== "success") {
    return gateResult("fail", [REASON.RUN_FAILED], checks);
  }
  if (run.path && run.path !== E2E_WORKFLOW_PATH) {
    return gateResult("fail", [REASON.UNTRUSTED_WORKFLOW], checks);
  }
  if (live.headSha && run.head_sha && run.head_sha !== live.headSha) {
    return gateResult("fail", [REASON.STALE_SHA], checks);
  }

  const reportEntry = readFileEntry(files, EVIDENCE_REPORT_FILE) ?? readFileEntry(files, "e2e-evidence.json");
  const parsed = parseJsonFile(reportEntry, REASON.MISSING_REPORT, REASON.MALFORMED_REPORT);
  if (parsed.reasonCodes.length) return gateResult("fail", parsed.reasonCodes, checks);

  const report = parsed.value;
  const shape = validateReportShape(report, schema);
  add("schema", shape.ok, shape.reasonCodes[0] ?? REASON.SCHEMA_INVALID);
  if (!shape.ok) return gateResult("fail", unique([...reasonCodes, ...shape.reasonCodes]), checks, { report });

  add("repository", report.repository === live.repository, REASON.WRONG_REPOSITORY);
  add("pr", Number(report.prNumber) === Number(live.prNumber), REASON.WRONG_PR);
  add("headSha", report.headSha === live.headSha, REASON.STALE_SHA);

  const requiredScenarios = (plan?.scenarios ?? []).map((item) => item.id);
  const reported = new Map((report.scenarios ?? []).map((item) => [item.id, item]));
  for (const id of requiredScenarios) {
    const scenario = reported.get(id);
    if (!scenario) {
      add(`scenario:${id}`, false, REASON.MISSING_SCENARIO);
      continue;
    }
    add(`scenario:${id}`, scenario.status === "pass", REASON.SCENARIO_FAILED);
    const shots = Array.isArray(scenario.screenshots) ? scenario.screenshots : [];
    if (shots.length < 1) add(`screenshots:${id}`, false, REASON.MISSING_SCREENSHOT);
    for (const shot of shots) {
      const buffer = fileBuffer(readFileEntry(files, shot));
      const pngOk = Boolean(buffer) && (policy?.artifacts?.screenshotMustLookLikePng === false || looksLikePng(buffer));
      add(`screenshot:${shot}`, pngOk, REASON.MISSING_SCREENSHOT);
    }
  }

  const traceBuffer = fileBuffer(readFileEntry(files, report.artifacts.trace));
  const traceOk = Boolean(traceBuffer) && (policy?.artifacts?.traceMustLookLikeZip === false || looksLikeZip(traceBuffer));
  add("trace", traceOk, REASON.MISSING_TRACE);

  const consoleFile = parseJsonFile(readFileEntry(files, report.artifacts.console), REASON.MISSING_CONSOLE, REASON.MALFORMED_REPORT);
  add("console-file", consoleFile.reasonCodes.length === 0, consoleFile.reasonCodes[0] ?? REASON.MISSING_CONSOLE);
  const networkFile = parseJsonFile(readFileEntry(files, report.artifacts.network), REASON.MISSING_NETWORK, REASON.MALFORMED_REPORT);
  add("network-file", networkFile.reasonCodes.length === 0, networkFile.reasonCodes[0] ?? REASON.MISSING_NETWORK);

  const rawConsole = Array.isArray(consoleFile.value) ? consoleFile.value : consoleFile.value?.entries;
  const rawNetwork = Array.isArray(networkFile.value) ? networkFile.value : networkFile.value?.entries;
  if (consoleFile.value != null && !Array.isArray(rawConsole)) reasonCodes.push(REASON.MALFORMED_REPORT);
  if (networkFile.value != null && !Array.isArray(rawNetwork)) reasonCodes.push(REASON.MALFORMED_REPORT);

  const consoleReasons = evaluateConsole(rawConsole ?? [], policy);
  const networkReasons = evaluateNetwork(rawNetwork ?? [], policy);
  for (const code of consoleReasons) add("console-policy", false, code);
  if (consoleReasons.length === 0 && consoleFile.reasonCodes.length === 0) add("console-policy", true);
  for (const code of networkReasons) add("network-policy", false, code);
  if (networkReasons.length === 0 && networkFile.reasonCodes.length === 0) add("network-policy", true);

  const uniqueReasons = unique(reasonCodes);
  return gateResult(uniqueReasons.length ? "fail" : "pass", uniqueReasons, checks, { report });
}

export function resolveE2eGate({
  runs,
  artifacts,
  live,
  files,
  plan,
  policy,
  schema,
} = {}) {
  const selectedRun = selectTrustedE2eRun(runs, live);
  if (!selectedRun.run) {
    return { action: "wait", verdict: "fail", reasonCodes: selectedRun.reasonCodes, checks: [] };
  }
  const status = String(selectedRun.run.status ?? "").toLowerCase();
  if (status === "in_progress" || status === "queued") {
    return { action: "wait", verdict: "fail", reasonCodes: [REASON.UNKNOWN_STATE], run: selectedRun.run, checks: [] };
  }

  const selectedArtifact = selectEvidenceArtifact(artifacts ?? [], live);
  const evaluation = evaluateE2eEvidence({
    live,
    run: selectedRun.run,
    files,
    plan,
    policy,
    schema,
  });

  if (evaluation.verdict !== "pass") {
    const action = evaluation.action === "wait" ? "wait" : "block";
    return { ...evaluation, action, run: selectedRun.run, artifact: selectedArtifact.artifact ?? null };
  }
  if (!selectedArtifact.artifact) {
    return {
      action: "block",
      verdict: "fail",
      reasonCodes: unique([...selectedArtifact.reasonCodes, REASON.MISSING_RUN]),
      run: selectedRun.run,
      checks: evaluation.checks,
    };
  }
  return { ...evaluation, action: "continue", run: selectedRun.run, artifact: selectedArtifact.artifact };
}

export function buildRepairSummary({ headSha, runUrl, reasonCodes, scenarios } = {}) {
  const codes = (reasonCodes ?? []).join(", ") || "unknown_state";
  const failed = (scenarios ?? []).filter((item) => item.status === "fail").map((item) => item.id);
  const scenarioText = failed.length ? ` Failed scenarios: ${failed.join(", ")}.` : "";
  return [
    `The E2E evidence gate failed for commit ${headSha}.`,
    `Reason codes: ${codes}.${scenarioText}`,
    runUrl ? `Inspect structured evidence at ${runUrl} (screenshots, traces, console, and network).` : "Inspect the Factory E2E evidence run artifacts.",
    "Do not reuse screenshots, traces, reports, or statuses from an older head.",
    "After the fix, push so browser verification reruns against the new exact head.",
  ].join(" ");
}

function gateResult(verdict, reasonCodes, checks, extra = {}) {
  return {
    verdict,
    reasonCodes: unique(reasonCodes),
    checks,
    action: extra.action ?? (verdict === "pass" ? "continue" : "block"),
    report: extra.report ?? null,
  };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg.startsWith("--") && next && !next.startsWith("--")) {
      out[arg.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function readArtifactDir(dir) {
  const files = {};
  const root = path.resolve(dir);
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const relative = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) walk(full);
      else files[relative] = { buffer: fs.readFileSync(full) };
    }
  };
  walk(root);
  return files;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const live = {
    repository: args.repository,
    prNumber: Number(args.pr),
    headSha: args["head-sha"],
  };
  const run = {
    name: E2E_WORKFLOW_NAME,
    path: E2E_WORKFLOW_PATH,
    conclusion: args["run-conclusion"] ?? "success",
    status: args["run-status"] ?? "completed",
    head_sha: args["run-head-sha"] ?? live.headSha,
    event: args["run-event"] ?? "pull_request",
    id: args["run-id"],
  };
  const files = args["artifact-dir"] ? readArtifactDir(args["artifact-dir"]) : {};
  const result = evaluateE2eEvidence({ live, run, files });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.verdict !== "pass") process.exitCode = 1;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(self)) await main();
