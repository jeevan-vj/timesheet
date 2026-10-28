import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  cleanupVerifyEnv,
  prepareVerifyEnv,
  verifyEnvContents,
  wranglerDevArgs,
} from "../.cursor/skills/verify-cleantrack/scripts/dev-vars.mjs";

const BASE_URL = "http://127.0.0.1:3017";
const temps = [];

function tempRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-dev-vars-"));
  temps.push(dir);
  return dir;
}

function mode(file) {
  return fs.statSync(file).mode & 0o777;
}

function silence(message) {
  throw new Error(message);
}

afterEach(() => {
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("verify-cleantrack dev vars", () => {
  it("writes a private run env file and does not create or modify project .dev.vars", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, ".wrangler/verify-cleantrack-run");
    fs.mkdirSync(path.join(rootDir, "dist/server"), { recursive: true });
    fs.writeFileSync(path.join(rootDir, "dist/server/.dev.vars"), "RESEND_API_KEY=sentinel\n", { mode: 0o644 });

    const { envFile } = prepareVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL });

    expect(envFile).toBe(path.resolve(runDir, "dev.vars"));
    expect(mode(envFile)).toBe(0o600);
    expect(fs.readFileSync(envFile, "utf8")).toContain(`BETTER_AUTH_URL=${BASE_URL}`);
    expect(fs.readFileSync(envFile, "utf8")).toContain("BETTER_AUTH_SECRET=");
    expect(fs.readFileSync(envFile, "utf8")).toContain("OPS_BOT_TOKEN=");
    expect(fs.existsSync(path.join(rootDir, ".dev.vars"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars.backup"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars.created"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, "dist/server/.dev.vars"))).toBe(false);
  });

  it("leaves an existing project file and an existing backup untouched on a second prepare", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(runDir, { recursive: true });
    const project = path.join(rootDir, ".dev.vars");
    const backup = path.join(runDir, "dev.vars.backup");
    fs.writeFileSync(project, "RESEND_API_KEY=original\n");
    fs.writeFileSync(backup, "RESEND_API_KEY=original\n");
    fs.writeFileSync(project, "BETTER_AUTH_SECRET=verify-copy\n");
    fs.writeFileSync(path.join(runDir, "dev.vars"), "old\n", { mode: 0o644 });

    prepareVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL });

    expect(fs.readFileSync(project, "utf8")).toBe("BETTER_AUTH_SECRET=verify-copy\n");
    expect(fs.readFileSync(backup, "utf8")).toBe("RESEND_API_KEY=original\n");
    expect(mode(path.join(runDir, "dev.vars"))).toBe(0o600);
  });

  it("restores a legacy backup once at mode 0600 and removes dist/server/.dev.vars", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(path.join(rootDir, "dist/server"), { recursive: true });
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, ".dev.vars"), verifyEnvContents(BASE_URL), { mode: 0o644 });
    fs.writeFileSync(path.join(runDir, "dev.vars.backup"), "RESEND_API_KEY=original\n", { mode: 0o644 });
    fs.writeFileSync(path.join(runDir, "dev.vars.created"), "created\n");
    fs.writeFileSync(path.join(rootDir, "dist/server/.dev.vars"), "secret\n");
    fs.writeFileSync(path.join(runDir, "dev.vars"), "run-secret\n");

    cleanupVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL, warn: silence });

    const project = path.join(rootDir, ".dev.vars");
    expect(fs.readFileSync(project, "utf8")).toBe("RESEND_API_KEY=original\n");
    expect(mode(project)).toBe(0o600);
    expect(fs.existsSync(path.join(runDir, "dev.vars.backup"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars.created"))).toBe(false);
    expect(fs.existsSync(path.join(rootDir, "dist/server/.dev.vars"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars"))).toBe(false);

    cleanupVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL, warn: silence });
    expect(fs.readFileSync(project, "utf8")).toBe("RESEND_API_KEY=original\n");
  });

  it("restores a legacy backup when the project .dev.vars is missing", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "dev.vars.backup"), "RESEND_API_KEY=original\n", { mode: 0o644 });

    cleanupVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL, warn: silence });

    const project = path.join(rootDir, ".dev.vars");
    expect(fs.readFileSync(project, "utf8")).toBe("RESEND_API_KEY=original\n");
    expect(mode(project)).toBe(0o600);
    expect(fs.existsSync(path.join(runDir, "dev.vars.backup"))).toBe(false);
  });

  it("removes a project file only when a legacy created flag marks the verify copy", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, ".dev.vars"), verifyEnvContents(BASE_URL));
    fs.writeFileSync(path.join(runDir, "dev.vars.created"), "created\n");

    cleanupVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL, warn: silence });

    expect(fs.existsSync(path.join(rootDir, ".dev.vars"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars.created"))).toBe(false);

    fs.writeFileSync(path.join(runDir, "dev.vars.created"), "created\n");
    cleanupVerifyEnv({ rootDir, runDir, baseUrl: BASE_URL, warn: silence });
    expect(fs.existsSync(path.join(rootDir, ".dev.vars"))).toBe(false);
    expect(fs.existsSync(path.join(runDir, "dev.vars.created"))).toBe(false);
  });

  it("keeps a real .dev.vars created after a legacy created flag", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(runDir, { recursive: true });
    const project = path.join(rootDir, ".dev.vars");
    const createdFlag = path.join(runDir, "dev.vars.created");
    fs.writeFileSync(project, "RESEND_API_KEY=real\n", { mode: 0o600 });
    fs.writeFileSync(createdFlag, "created\n");
    const warnings = [];

    cleanupVerifyEnv({
      rootDir,
      runDir,
      baseUrl: BASE_URL,
      warn: (message) => warnings.push(message),
    });

    expect(fs.readFileSync(project, "utf8")).toBe("RESEND_API_KEY=real\n");
    expect(mode(project)).toBe(0o600);
    expect(fs.existsSync(createdFlag)).toBe(true);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("left");
    expect(warnings[0]).toContain(createdFlag);
    expect(warnings[0]).not.toContain("RESEND_API_KEY");
  });

  it("keeps a newer .dev.vars and a stale backup at mode 0600", () => {
    const rootDir = tempRoot();
    const runDir = path.join(rootDir, "run");
    fs.mkdirSync(runDir, { recursive: true });
    const project = path.join(rootDir, ".dev.vars");
    const backup = path.join(runDir, "dev.vars.backup");
    fs.writeFileSync(project, "RESEND_API_KEY=newer\n", { mode: 0o644 });
    fs.writeFileSync(backup, "RESEND_API_KEY=stale\n", { mode: 0o644 });
    const warnings = [];

    cleanupVerifyEnv({
      rootDir,
      runDir,
      baseUrl: BASE_URL,
      warn: (message) => warnings.push(message),
    });

    expect(fs.readFileSync(project, "utf8")).toBe("RESEND_API_KEY=newer\n");
    expect(mode(project)).toBe(0o644);
    expect(fs.readFileSync(backup, "utf8")).toBe("RESEND_API_KEY=stale\n");
    expect(mode(backup)).toBe(0o600);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(backup);
    expect(warnings[0]).toContain("0600");
    expect(warnings[0]).not.toContain("RESEND_API_KEY");
  });

  it("passes an absolute env file to wrangler and refuses a relative one", () => {
    const args = wranglerDevArgs({
      port: "3017",
      persist: "/tmp/persist",
      release: "verify-cleantrack",
      baseUrl: BASE_URL,
      envFile: "/tmp/run/dev.vars",
    });
    expect(args).toContain("--env-file");
    expect(args[args.indexOf("--env-file") + 1]).toBe("/tmp/run/dev.vars");
    expect(args).toContain(`BETTER_AUTH_URL:${BASE_URL}`);
    expect(args).toContain(`AUTH_TRUSTED_ORIGINS:${BASE_URL}`);
    expect(args).toContain("RELEASE_SHA:verify-cleantrack");
    expect(args.join(" ")).not.toContain(".dev.vars");
    expect(() => wranglerDevArgs({
      port: "3017",
      persist: "/tmp/persist",
      release: "verify-cleantrack",
      baseUrl: BASE_URL,
      envFile: "dist/server/.dev.vars",
    })).toThrow(/absolute/);
  });
});
