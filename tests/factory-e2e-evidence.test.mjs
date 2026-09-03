import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  E2E_JOB_NAME,
  E2E_WORKFLOW_NAME,
  EVIDENCE_SCHEMA_VERSION,
  REASON,
  artifactNameForSha,
  buildRepairSummary,
  evaluateE2eEvidence,
  loadEvidenceSchema,
  loadPlan,
  loadPolicy,
  resolveE2eGate,
  selectEvidenceArtifact,
  selectTrustedE2eRun,
  validateReportShape,
} from "../.factory/evaluate-e2e-evidence.mjs";
import { looksLikePng, looksLikeZip, redactSecrets, sanitizeHeaders, sanitizeUrl } from "../.factory/e2e/sanitize.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
const SHA_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const SHA_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const LIVE = { repository: "jeevan-vj/timesheet", prNumber: 34, headSha: SHA_A };

function screenshot(id) {
  return `screenshots/${id}.png`;
}

function validReport(overrides = {}) {
  const scenarios = [
    { id: "health-ok", status: "pass", screenshots: [screenshot("health-ok")] },
    { id: "owner-signup", status: "pass", screenshots: [screenshot("owner-signup")] },
    { id: "empty-week-dashboard", status: "pass", screenshots: [screenshot("empty-week-dashboard")] },
  ];
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    repository: LIVE.repository,
    prNumber: LIVE.prNumber,
    headSha: SHA_A,
    run: {
      workflow: E2E_WORKFLOW_NAME,
      workflowRunId: "99",
      job: E2E_JOB_NAME,
      event: "pull_request",
    },
    timestamp: "2026-09-03T06:00:00.000Z",
    app: { baseUrl: "http://127.0.0.1:8787", environment: "factory-local-worker" },
    scenarios,
    artifacts: {
      trace: "trace.zip",
      console: "console.json",
      network: "network.json",
      screenshots: scenarios.flatMap((item) => item.screenshots),
    },
    console: { errors: [], warnings: [] },
    network: { failures: [] },
    checks: [],
    overallVerdict: "pass",
    reasonCodes: [],
    ...overrides,
  };
}

function passingFiles(report = validReport()) {
  const files = {
    "e2e-evidence.json": JSON.stringify(report),
    "trace.zip": ZIP,
    "console.json": JSON.stringify([]),
    "network.json": JSON.stringify([]),
  };
  for (const scenario of report.scenarios ?? []) {
    for (const shot of scenario.screenshots ?? []) files[shot] = PNG;
  }
  return files;
}

function successRun(overrides = {}) {
  return {
    id: 11,
    name: E2E_WORKFLOW_NAME,
    path: ".github/workflows/factory-e2e.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: SHA_A,
    updated_at: "2026-09-03T06:00:00Z",
    ...overrides,
  };
}

function evaluate(overrides = {}) {
  return evaluateE2eEvidence({
    live: LIVE,
    run: successRun(),
    files: passingFiles(),
    plan: loadPlan(),
    policy: loadPolicy(),
    ...overrides,
  });
}

describe("factory E2E evidence contract", () => {
  it("loads a versioned schema, default owner-path plan, and fail-closed policy", () => {
    const schema = loadEvidenceSchema();
    const plan = loadPlan();
    const policy = loadPolicy();
    expect(schema.properties.schemaVersion.const).toBe("1");
    expect(plan.scenarios.map((item) => item.id)).toEqual([
      "health-ok",
      "owner-signup",
      "empty-week-dashboard",
    ]);
    expect(plan.scenarios.some((item) => item.path === "/")).toBe(false);
    expect(policy.console.allowlist).toEqual([]);
    expect(policy.network.allowlist).toEqual([]);
    expect(policy.artifacts.retentionDays).toBe(14);
    expect(validateReportShape(validReport()).ok).toBe(true);
  });

  it("passes current-head evidence and ignores a forged producer overallVerdict", () => {
    const report = validReport({ overallVerdict: "pass" });
    const files = passingFiles(report);
    files["console.json"] = JSON.stringify([{ type: "error", text: "boom" }]);
    const forgedPass = evaluate({ files });
    expect(forgedPass.verdict).toBe("fail");
    expect(forgedPass.reasonCodes).toContain(REASON.CONSOLE_ERROR);

    const nested = {};
    for (const [key, value] of Object.entries(passingFiles())) nested[`factory-e2e-output/${key}`] = value;
    expect(evaluate({ files: nested }).verdict).toBe("pass");

    const honest = evaluate();
    expect(honest.verdict).toBe("pass");
    expect(honest.reasonCodes).toEqual([]);
    expect(honest.action).toBe("continue");
  });

  it("rejects stale SHA A evidence when the live head is SHA B", () => {
    const report = validReport({ headSha: SHA_A });
    const result = evaluate({
      live: { ...LIVE, headSha: SHA_B },
      run: successRun({ head_sha: SHA_B }),
      files: passingFiles(report),
    });
    expect(result.verdict).toBe("fail");
    expect(result.reasonCodes).toContain(REASON.STALE_SHA);
    expect(selectTrustedE2eRun([successRun()], { headSha: SHA_B }).run).toBeNull();
    expect(selectEvidenceArtifact([{ name: artifactNameForSha(SHA_A), expired: false }], { headSha: SHA_B }).artifact).toBeNull();
  });

  it("rejects wrong repository or PR bindings", () => {
    expect(evaluate({ live: { ...LIVE, repository: "other/repo" } }).reasonCodes).toContain(REASON.WRONG_REPOSITORY);
    expect(evaluate({ live: { ...LIVE, prNumber: 99 } }).reasonCodes).toContain(REASON.WRONG_PR);
  });

  it("fails closed on missing artifacts and malformed reports", () => {
    expect(evaluate({ files: {} }).reasonCodes).toContain(REASON.MISSING_REPORT);
    expect(evaluate({ files: { "e2e-evidence.json": "{not json" } }).reasonCodes).toContain(REASON.MALFORMED_REPORT);
    expect(evaluate({ files: { "e2e-evidence.json": JSON.stringify({ schemaVersion: "1" }) } }).reasonCodes).toContain(REASON.SCHEMA_INVALID);

    const missingShot = passingFiles();
    delete missingShot["screenshots/owner-signup.png"];
    expect(evaluate({ files: missingShot }).reasonCodes).toContain(REASON.MISSING_SCREENSHOT);

    const missingTrace = passingFiles();
    delete missingTrace["trace.zip"];
    expect(evaluate({ files: missingTrace }).reasonCodes).toContain(REASON.MISSING_TRACE);

    const missingConsole = passingFiles();
    delete missingConsole["console.json"];
    expect(evaluate({ files: missingConsole }).reasonCodes).toContain(REASON.MISSING_CONSOLE);

    const missingNetwork = passingFiles();
    delete missingNetwork["network.json"];
    expect(evaluate({ files: missingNetwork }).reasonCodes).toContain(REASON.MISSING_NETWORK);
  });

  it("fails closed on failed scenarios, console, and network policy violations", () => {
    const failedScenario = validReport();
    failedScenario.scenarios[2].status = "fail";
    expect(evaluate({ files: passingFiles(failedScenario) }).reasonCodes).toContain(REASON.SCENARIO_FAILED);

    const consoleFail = passingFiles();
    consoleFail["console.json"] = JSON.stringify([{ type: "warning", text: "deprecated" }]);
    expect(evaluate({ files: consoleFail }).reasonCodes).toContain(REASON.CONSOLE_WARNING);

    const networkFail = passingFiles();
    networkFail["network.json"] = JSON.stringify([{ method: "GET", url: "http://127.0.0.1:8787/api/dashboard", status: 500 }]);
    expect(evaluate({ files: networkFail }).reasonCodes).toContain(REASON.NETWORK_FAILURE);
  });

  it("treats cancelled, failed, and unknown producer runs as not verified", () => {
    expect(evaluate({ run: successRun({ conclusion: "cancelled" }) }).reasonCodes).toContain(REASON.RUN_CANCELLED);
    expect(evaluate({ run: successRun({ conclusion: "failure" }) }).reasonCodes).toContain(REASON.RUN_FAILED);
    expect(evaluate({ run: {} }).reasonCodes).toContain(REASON.UNKNOWN_STATE);
    expect(evaluate({ run: successRun({ path: ".github/workflows/forged.yml" }) }).reasonCodes).toContain(REASON.UNTRUSTED_WORKFLOW);
  });

  it("routes a failed evidence run to repair and requires a fresh run after the head changes", () => {
    const failed = resolveE2eGate({
      live: LIVE,
      runs: [successRun({ conclusion: "failure" })],
      artifacts: [{ name: artifactNameForSha(SHA_A), expired: false, workflow_run: { path: ".github/workflows/factory-e2e.yml" } }],
      files: passingFiles(),
    });
    expect(failed.action).toBe("block");
    expect(failed.verdict).toBe("fail");
    expect(buildRepairSummary({
      headSha: SHA_A,
      runUrl: "https://github.com/jeevan-vj/timesheet/actions/runs/9",
      reasonCodes: failed.reasonCodes,
      scenarios: [{ id: "owner-signup", status: "fail" }],
    })).toContain("Failed scenarios: owner-signup");

    const afterRepair = resolveE2eGate({
      live: { ...LIVE, headSha: SHA_B },
      runs: [successRun({ head_sha: SHA_A })],
      artifacts: [{ name: artifactNameForSha(SHA_A), expired: false }],
      files: passingFiles(validReport({ headSha: SHA_A })),
    });
    expect(afterRepair.action).toBe("wait");
    expect(afterRepair.reasonCodes).toContain(REASON.MISSING_RUN);

    const rerun = resolveE2eGate({
      live: { ...LIVE, headSha: SHA_B },
      runs: [successRun({ head_sha: SHA_B, updated_at: "2026-09-03T07:00:00Z" })],
      artifacts: [{ name: artifactNameForSha(SHA_B), expired: false, updated_at: "2026-09-03T07:00:00Z", workflow_run: { path: ".github/workflows/factory-e2e.yml" } }],
      files: passingFiles(validReport({ headSha: SHA_B })),
    });
    expect(rerun.action).toBe("continue");
    expect(rerun.verdict).toBe("pass");
  });

  it("sanitizes cookies, tokens, and secret query values before evidence is retained", () => {
    expect(sanitizeHeaders({ Cookie: "session=abc", "Content-Type": "application/json" }).Cookie).toBe("redacted");
    expect(sanitizeUrl("http://127.0.0.1:8787/api?token=super-secret")).toContain("redacted");
    expect(redactSecrets("Authorization: Bearer super-secret-token")).toContain("redacted");
    expect(looksLikePng(PNG)).toBe(true);
    expect(looksLikeZip(ZIP)).toBe(true);
    const docs = fs.readFileSync(new URL("../.factory/e2e-evidence.md", import.meta.url), "utf8");
    expect(docs).toContain("Trust boundary");
    expect(docs).toContain("schemaVersion");
    expect(docs).toContain("retention");
    expect(docs).toContain("Local / debug");
  });
});

describe("factory E2E workflows stay fail-closed and complementary", () => {
  const controller = fs.readFileSync(new URL("../.github/workflows/factory-controller.yml", import.meta.url), "utf8");
  const repair = fs.readFileSync(new URL("../.github/workflows/factory-repair.yml", import.meta.url), "utf8");
  const prGate = fs.readFileSync(new URL("../.github/workflows/factory-pr.yml", import.meta.url), "utf8");
  const e2e = fs.readFileSync(new URL("../.github/workflows/factory-e2e.yml", import.meta.url), "utf8");
  const harness = fs.readFileSync(new URL("../.factory/e2e/harness.mjs", import.meta.url), "utf8");
  const smoke = fs.readFileSync(new URL("../.github/scripts/production-smoke.mjs", import.meta.url), "utf8");
  const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  it("keeps the deterministic gate unchanged and adds a separate E2E evidence workflow", () => {
    expect(prGate).toContain("name: Factory deterministic gate");
    expect(prGate).toContain("pnpm install --frozen-lockfile");
    expect(prGate).toContain("pnpm test");
    expect(prGate).toContain("pnpm typecheck");
    expect(prGate).toContain("pnpm build");
    expect(prGate).not.toContain("playwright");
    expect(e2e).toContain(`name: ${E2E_WORKFLOW_NAME}`);
    expect(e2e).toContain(`name: ${E2E_JOB_NAME}`);
    expect(e2e).toContain("pull_request:");
    expect(e2e).toContain("pnpm exec playwright install --with-deps chromium");
    expect(e2e).toContain("node .factory/e2e/harness.mjs");
    expect(e2e).toContain("evaluate-e2e-evidence.mjs");
    expect(e2e).toContain("retention-days: 14");
    expect(e2e).toContain("persist-credentials: false");
    expect(e2e).toContain("pull-requests: read");
    expect(e2e).toContain('gh api "repos/${{ github.repository }}/pulls/${{ github.event.pull_request.number }}"');
    expect(e2e).toContain("cp .dev.vars dist/server/.dev.vars");
    expect(harness).toContain('path.join(distDir, ".dev.vars")');
    expect(harness).toContain('await page.getByText("No shifts this week").waitFor({ timeout: 30_000 });');
    expect(harness).toContain('await page.waitForLoadState("networkidle");');
    expect(e2e).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(e2e).not.toContain("gh api");
    expect(e2e).not.toContain("GH_TOKEN");
    expect(e2e).toContain("github.event.pull_request.head.sha");
    expect(e2e).toContain('--var "BETTER_AUTH_URL:${FACTORY_E2E_BASE_URL}"');
    expect(e2e).toContain('--var "AUTH_TRUSTED_ORIGINS:${FACTORY_E2E_BASE_URL}"');
    expect((e2e.match(/^permissions:\n  contents: read$/m) || []).length).toBe(1);
  });

  it("makes the trusted controller validate current-head artifacts before merge evaluation", () => {
    expect(controller).toContain("Factory E2E Evidence");
    expect(controller).toContain("evaluate-e2e-evidence.mjs");
    expect(controller).toContain("Factory E2E evidence");
    expect(controller).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(controller).toContain("sparse-checkout: .factory");
    expect(controller).toContain('if [ "$risk" != low ]');
    expect(controller).toContain("selectMergeableFactoryReview");
    expect(controller).not.toContain("factory-e2e-bypass");
  });

  it("routes E2E failure through the existing two-cycle repair path with no bypass", () => {
    expect(repair).toContain("Factory E2E Evidence");
    expect(repair).toContain('kind="e2e"');
    expect(repair).toContain("if [ \"$attempts\" -ge 2 ]");
    expect(repair).not.toContain("actions/checkout");
    expect(repair).toContain("[ \"$head\" = \"$RUN_HEAD_SHA\" ]");
    expect(repair).toContain("Do not reuse");
    expect(smoke).toContain("/api/health");
    expect(smoke).not.toContain("playwright");
    expect(release).not.toContain("factory-e2e");
  });
});
