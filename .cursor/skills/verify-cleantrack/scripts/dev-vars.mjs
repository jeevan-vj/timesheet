import fs from "node:fs";
import path from "node:path";

// Wrangler 4.127 getVarsForDev loads only --env-file when that flag is set,
// instead of the project .dev.vars. Those paths resolve against the directory
// of --config (dist/server), so the path has to be absolute. secrets.required
// (BETTER_AUTH_SECRET, OPS_BOT_TOKEN) still have to be in the file.

export function verifyEnvContents(baseUrl) {
  return [
    "BETTER_AUTH_SECRET=local-development-secret-change-me-123456789",
    `BETTER_AUTH_URL=${baseUrl}`,
    `AUTH_TRUSTED_ORIGINS=${baseUrl}`,
    "OPS_BOT_TOKEN=local-ops-bot-token-change-me",
    "",
  ].join("\n");
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file) : null;
}

function assertUnchanged(file, before, label) {
  const after = readIfExists(file);
  if (before === null) {
    if (after !== null) throw new Error(`verify launch must not create ${label}`);
    return;
  }
  if (after === null || !after.equals(before)) {
    throw new Error(`verify launch must not modify ${label}`);
  }
}

function writePrivate(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function prepareVerifyEnv({ rootDir, runDir, baseUrl }) {
  const projectDevVars = path.join(rootDir, ".dev.vars");
  const backupPath = path.join(runDir, "dev.vars.backup");
  const createdFlag = path.join(runDir, "dev.vars.created");
  const projectBefore = readIfExists(projectDevVars);
  const backupBefore = readIfExists(backupPath);
  const createdBefore = fs.existsSync(createdFlag);

  fs.mkdirSync(runDir, { recursive: true });
  const envFile = path.resolve(runDir, "dev.vars");
  writePrivate(envFile, verifyEnvContents(baseUrl));
  fs.rmSync(path.join(rootDir, "dist/server/.dev.vars"), { force: true });

  assertUnchanged(projectDevVars, projectBefore, "project .dev.vars");
  assertUnchanged(backupPath, backupBefore, ".dev.vars backup");
  if (fs.existsSync(createdFlag) !== createdBefore) {
    throw new Error("verify launch must not change the .dev.vars created flag");
  }
  return { envFile };
}

export function cleanupVerifyEnv({ rootDir, runDir }) {
  const devVarsPath = path.join(rootDir, ".dev.vars");
  const backupPath = path.join(runDir, "dev.vars.backup");
  const createdFlag = path.join(runDir, "dev.vars.created");
  if (fs.existsSync(backupPath)) {
    writePrivate(devVarsPath, fs.readFileSync(backupPath));
    fs.rmSync(backupPath, { force: true });
    fs.rmSync(createdFlag, { force: true });
  } else if (fs.existsSync(createdFlag)) {
    fs.rmSync(devVarsPath, { force: true });
    fs.rmSync(createdFlag, { force: true });
  }
  fs.rmSync(path.join(rootDir, "dist/server/.dev.vars"), { force: true });
  fs.rmSync(path.join(runDir, "dev.vars"), { force: true });
}

export function wranglerDevArgs({ port, persist, release, baseUrl, envFile }) {
  if (!path.isAbsolute(envFile)) {
    throw new Error("wrangler --env-file path must be absolute so it is not resolved against dist/server");
  }
  return [
    "exec",
    "wrangler",
    "dev",
    "--config",
    "dist/server/wrangler.json",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--persist-to",
    persist,
    "--env-file",
    envFile,
    "--var",
    `BETTER_AUTH_URL:${baseUrl}`,
    "--var",
    `AUTH_TRUSTED_ORIGINS:${baseUrl}`,
    "--var",
    `RELEASE_SHA:${release}`,
  ];
}
