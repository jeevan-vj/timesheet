import fs from "node:fs";

import { describe, expect, it } from "vitest";

const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const preview = fs.readFileSync(new URL("../.github/workflows/preview.yml", import.meta.url), "utf8");
const recovery = fs.readFileSync(new URL("../.github/scripts/record-recovery-point.mjs", import.meta.url), "utf8");
const rollback = fs.readFileSync(new URL("../.github/scripts/rollback-worker.mjs", import.meta.url), "utf8");
const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

describe("release and preview workflow guards", () => {
  it("records the bookmark before migrations apply and rolls back without restoring D1", () => {
    const record = release.indexOf("record-recovery-point.mjs");
    const apply = release.indexOf("d1 migrations apply cleantrack-timesheet");
    const rollbackStep = release.indexOf("rollback-worker.mjs");
    expect(record).toBeGreaterThan(0);
    expect(record).toBeLessThan(apply);
    expect(rollbackStep).toBeGreaterThan(apply);
    expect(release).toContain("always() && (steps.identity.outcome == 'failure' || steps.smoke.outcome == 'failure')");
    expect(release).toContain("d1-recovery-${{ github.sha }}");
    expect(release).not.toContain("time-travel restore");
    expect(recovery).toContain('"time-travel"');
    expect(recovery).toContain('"info"');
    expect(recovery).not.toContain("restore");
    expect(rollback).not.toContain("time-travel");
  });

  it("skips preview deploy when configuration is missing and still fails a real deploy error", () => {
    expect(preview).toContain("needs.preview-config.outputs.ready == 'true'");
    expect(preview).toContain("Preview deploy skipped");
    const deployJob = preview.slice(preview.indexOf("deploy-preview:"));
    expect(deployJob).not.toContain("ready=false");
    expect(deployJob).toContain("wrangler deploy");
    expect(deployJob).not.toContain("exit 0");
  });

  it("runs mobile, core, and the production audit in CI", () => {
    expect(ci).toContain("pnpm --filter mobile typecheck");
    expect(ci).toContain("pnpm --filter mobile lint");
    expect(ci).toContain("pnpm --filter mobile test");
    expect(ci).toContain("npx --yes expo-doctor");
    expect(ci).toContain("pnpm --filter @cleantrack/core test");
    expect(ci).toContain("pnpm audit --audit-level=high --prod");
    expect(ci).toContain("permissions:\n  contents: read");
  });
});
