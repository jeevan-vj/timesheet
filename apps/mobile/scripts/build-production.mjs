import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import { checkRelease } from "./check-release.mjs";

export function productionEasArgs(argv) {
  const extra = argv[0] === "--" ? argv.slice(1) : argv.slice();
  return ["build", "--platform", "ios", "--profile", "production", ...extra];
}

function easEnv(env) {
  return { ...env, APP_VARIANT: "production" };
}

function preUploadEnv(env) {
  const checkEnv = { ...env, EAS_BUILD_PROFILE: "production" };
  delete checkEnv.EAS_BUILD;
  return checkEnv;
}

export async function runProductionBuild({ env, argv, runCheck = checkRelease, spawnEas }) {
  await runCheck({ env: preUploadEnv(env), argv: [] });
  return spawnEas(productionEasArgs(argv), easEnv(env));
}

function spawnEas(args, env) {
  return new Promise((resolve) => {
    const child = spawn("eas", args, { env, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("exit", (code) => resolve(code ?? 1));
  });
}

async function main() {
  try {
    const code = await runProductionBuild({
      env: process.env,
      argv: process.argv.slice(2),
      spawnEas,
    });
    if (code !== 0) process.exitCode = code;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "production release check failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
