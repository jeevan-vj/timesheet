import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { planMobileRelease, runPlanCli } from "../apps/mobile/scripts/plan-release.mjs";

const HASH = "a".repeat(40);
const OTHER = "b".repeat(40);
const SHA = "c".repeat(40);
const NOW = new Date("2026-10-27T00:00:00.000Z");

function finished(overrides = {}) {
  return {
    id: "build-finished",
    status: "FINISHED",
    platform: "IOS",
    buildProfile: "production",
    channel: "production",
    distribution: "STORE",
    fingerprint: { hash: HASH },
    appVersion: "0.1.0",
    appBuildVersion: "12",
    expirationDate: "2099-01-01T00:00:00.000Z",
    secrets: "do-not-print",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return planMobileRelease({
    mode: "auto",
    fingerprintHash: HASH,
    updateFingerprintHash: HASH,
    builds: [],
    now: NOW,
    ...overrides,
  });
}

describe("mobile release plan", () => {
  it("publishes an OTA when a finished production iOS build has the fingerprint", () => {
    const decision = plan({ builds: [finished()] });
    expect(decision.path).toBe("update");
    expect(decision.matchingBuild.id).toBe("build-finished");
    expect(decision.warning).toBe("");
    expect(JSON.stringify(decision)).not.toContain("do-not-print");
  });

  it("keeps an expired finished artifact on the OTA path", () => {
    const expired = plan({
      builds: [finished({ expirationDate: "2020-01-01T00:00:00.000Z", isExpired: true })],
    });
    expect(expired.path).toBe("update");
    expect(expired.matchingBuild.artifactExpired).toBe(true);
    expect(expired.warning).toContain("expired");

    const flagOnly = plan({ builds: [finished({ expirationDate: "2099-01-01T00:00:00.000Z", isExpired: true })] });
    expect(flagOnly.matchingBuild.artifactExpired).toBe(true);
  });

  it("prefers a finished build over an in-progress build with the same fingerprint", () => {
    const decision = plan({
      builds: [
        finished({ id: "build-running", status: "in-progress", expirationDate: "" }),
        finished({ id: "build-done", status: "finished" }),
      ],
    });
    expect(decision.path).toBe("update");
    expect(decision.matchingBuild).toMatchObject({ id: "build-done", status: "FINISHED" });
  });

  it("publishes an OTA for an in-progress build and does not start a second store build", () => {
    const decision = plan({ builds: [finished({ id: "build-queued", status: "IN_QUEUE" })] });
    expect(decision.path).toBe("update");
    expect(decision.warning).toContain("No finished production binary");
  });

  it("starts a build when the only matches are errored, canceled, android, internal, or a different hash", () => {
    const builds = [
      finished({ id: "errored", status: "ERRORED" }),
      finished({ id: "canceled", status: "canceled" }),
      finished({ id: "android", platform: "ANDROID" }),
      finished({ id: "preview", buildProfile: "preview" }),
      finished({ id: "other-channel", channel: "preview" }),
      finished({ id: "internal", distribution: "INTERNAL" }),
      finished({ id: "simulator", simulator: true }),
      finished({ id: "other-hash", fingerprint: { hash: OTHER } }),
      finished({ id: "runtime-disagrees", fingerprint: { hash: OTHER }, runtimeVersion: HASH }),
      { status: "FINISHED", platform: "IOS" },
    ];
    expect(plan({ builds }).path).toBe("build");
    expect(plan({ builds: [] }).path).toBe("build");
  });

  it("accepts a runtime version when the build list has no fingerprint object", () => {
    const decision = plan({
      builds: [finished({ fingerprint: undefined, fingerprintHash: "", runtimeVersion: HASH })],
    });
    expect(decision.path).toBe("update");
  });

  it("accepts a flat fingerprintHash from eas build:list", () => {
    const decision = plan({
      builds: [finished({ fingerprint: undefined, fingerprintHash: HASH.toUpperCase() })],
    });
    expect(decision.matchingBuild.id).toBe("build-finished");
  });

  it("force-build always builds and force-update always publishes", () => {
    const forcedBuild = plan({ mode: "force-build", builds: [finished()] });
    expect(forcedBuild.path).toBe("build");
    expect(forcedBuild.matchingBuild.id).toBe("build-finished");
    expect(forcedBuild.warning).toContain("remote build number increments once");

    const forcedUpdate = plan({ mode: "force-update", builds: [] });
    expect(forcedUpdate.path).toBe("update");
    expect(forcedUpdate.warning).toContain("will not reach installed binaries");

    expect(plan({ mode: "force-update", builds: [finished()] }).warning).toBe("");
  });

  it("stops when the update environment fingerprint differs from the build profile", () => {
    for (const mode of ["auto", "force-build", "force-update"]) {
      const decision = plan({ mode, updateFingerprintHash: OTHER, builds: [finished()] });
      expect(decision.path).toBe("blocked");
      expect(decision.updateFingerprintHash).toBe(OTHER);
      expect(decision.warning).toContain("No OTA was published");
    }
  });

  it("rejects an unknown mode, a bad hash, and a non-array build list", () => {
    expect(() => plan({ mode: "ship" })).toThrow("unknown mobile release mode");
    expect(() => plan({ fingerprintHash: "not-a-hash" })).toThrow("fingerprint hash");
    expect(() => plan({ builds: {} })).toThrow("JSON array");
  });

  it("writes the job summary and GitHub outputs without the raw build payload", () => {
    const dir = mkdtempSync(join(tmpdir(), "mobile-release-"));
    const fingerprint = join(dir, "fingerprint.json");
    const builds = join(dir, "builds.json");
    const summary = join(dir, "summary.md");
    const output = join(dir, "output.txt");
    writeFileSync(fingerprint, JSON.stringify({ hash: HASH, sources: [{ value: "do-not-print" }] }));
    writeFileSync(builds, JSON.stringify([finished()]));
    let stdout = "";
    const result = runPlanCli(
      [
        "--mode",
        "auto",
        "--sha",
        SHA,
        "--fingerprint-file",
        fingerprint,
        "--update-fingerprint-file",
        fingerprint,
        "--builds",
        builds,
        "--summary",
        summary,
        "--github-output",
        output,
      ],
      { stdout: (chunk) => { stdout += chunk; } },
    );
    expect(result.exitCode).toBe(0);
    expect(stdout).toContain('"path":"update"');
    expect(stdout).not.toContain("do-not-print");
    const summaryText = readFileSync(summary, "utf8");
    expect(summaryText).toContain("Publish an OTA");
    expect(summaryText).toContain(HASH);
    expect(summaryText).toContain("`build-finished`");
    expect(summaryText).toContain("mobile-production");
    expect(summaryText).not.toContain("do-not-print");
    expect(readFileSync(output, "utf8")).toBe(
      `path=update\nfingerprint=${HASH}\nmatching_build_id=build-finished\nsha=${SHA}\n`,
    );
  });

  it("exits non-zero on a fingerprint mismatch and does not set a release path output", () => {
    const dir = mkdtempSync(join(tmpdir(), "mobile-release-"));
    const buildFingerprint = join(dir, "build.json");
    const updateFingerprint = join(dir, "update.json");
    const builds = join(dir, "builds.json");
    const summary = join(dir, "summary.md");
    const output = join(dir, "output.txt");
    writeFileSync(buildFingerprint, JSON.stringify({ hash: HASH }));
    writeFileSync(updateFingerprint, JSON.stringify({ hash: OTHER }));
    writeFileSync(builds, "[]");
    writeFileSync(output, "");
    let stderr = "";
    let stdout = "";
    const result = runPlanCli(
      [
        "--mode",
        "force-update",
        "--sha",
        SHA,
        "--fingerprint-file",
        buildFingerprint,
        "--update-fingerprint-file",
        updateFingerprint,
        "--builds",
        builds,
        "--summary",
        summary,
        "--github-output",
        output,
      ],
      {
        stdout: (chunk) => { stdout += chunk; },
        stderr: (chunk) => { stderr += chunk; },
      },
    );
    expect(stdout).toContain('"path":"blocked"');
    expect(result.exitCode).toBe(1);
    expect(stderr).toBe("");
    expect(readFileSync(summary, "utf8")).toContain("disagree");
    expect(readFileSync(output, "utf8")).toBe("");
  });

  it("prints a fingerprint hash and rejects a document that is not JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "mobile-release-"));
    const file = join(dir, "fingerprint.json");
    writeFileSync(file, JSON.stringify({ hash: HASH, sources: [] }));
    let stdout = "";
    expect(runPlanCli(["--print-hash", file], { stdout: (chunk) => { stdout += chunk; } }).exitCode).toBe(0);
    expect(stdout).toBe(`${HASH}\n`);

    writeFileSync(file, "{");
    let stderr = "";
    const failed = runPlanCli(["--print-hash", file], { stderr: (chunk) => { stderr += chunk; } });
    expect(failed.exitCode).toBe(1);
    expect(stderr).toContain("could not be parsed");
    expect(stderr).not.toContain("{");
  });
});

describe("mobile release workflow contract", () => {
  const workflow = readFileSync(new URL("../.github/workflows/mobile-release.yml", import.meta.url), "utf8");
  const web = readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

  it("gates publish and build on mobile-production and decides with fingerprint-hash", () => {
    expect(workflow).toContain("name: mobile-production");
    expect(workflow).toContain("group: cleantrack-mobile-production");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("--fingerprint-hash");
    expect(workflow).toContain("--auto-submit");
    expect(workflow).toContain("--freeze-credentials");
    expect(workflow).toContain("update:production");
    expect(workflow).toContain("eas-cli@25.3.0");
    expect(workflow).toContain("apps/mobile/**");
    expect(workflow).toContain("packages/core/**");
    expect(workflow).toContain("pnpm-lock.yaml");
    expect(workflow).toContain("package.json");
    expect(workflow).toContain("pnpm-workspace.yaml");
    expect(workflow).toContain("force-build");
    expect(workflow).toContain("force-update");
    expect(workflow).toContain("jeevan-vj/timesheet");
    expect(workflow).toContain("APP_VARIANT=production");
    expect(workflow).not.toContain("continuous-deploy-fingerprint");
    expect(workflow).not.toContain("--runtime-version");
    expect(workflow).not.toContain("echo \"$EXPO_TOKEN\"");
    expect(workflow).not.toContain("echo ${{ secrets");
    expect(workflow).not.toContain("cancel-in-progress: true");
  });

  it("keeps the web Worker release on its own workflow", () => {
    expect(web).toContain("name: Release to Cloudflare");
    expect(web).toContain("group: cleantrack-production");
    expect(web).not.toContain("mobile-production");
    expect(web).not.toContain("eas build");
  });

  it("keeps remote iOS build numbers and the fingerprint runtime policy", () => {
    const eas = JSON.parse(readFileSync(new URL("../apps/mobile/eas.json", import.meta.url), "utf8"));
    expect(eas.cli.appVersionSource).toBe("remote");
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.build.production.channel).toBe("production");
    expect(eas.submit.production.ios.ascAppId).toBe("6827417051");
    const config = readFileSync(new URL("../apps/mobile/app.config.ts", import.meta.url), "utf8");
    expect(config).toContain('policy: "fingerprint"');
    const scripts = JSON.parse(readFileSync(new URL("../apps/mobile/package.json", import.meta.url), "utf8"));
    expect(scripts.scripts["update:production"]).toBe(
      "APP_VARIANT=production eas update --channel production --environment production",
    );
    expect(scripts.scripts["eas-build-pre-install"]).toBe("node scripts/check-release.mjs");
  });
});
