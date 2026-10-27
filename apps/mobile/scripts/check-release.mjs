import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

const KNOWN_PROFILES = new Set(["development", "preview", "production"]);

export function resolveProfile(env, argv) {
  const inline = argv.find((arg) => arg.startsWith("--profile="));
  if (inline) return inline.slice("--profile=".length);
  const index = argv.indexOf("--profile");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return env.EAS_BUILD_PROFILE ?? "";
}

function execGit(args) {
  return new Promise((resolve) => {
    execFile("git", args, { encoding: "utf8" }, (error, stdout) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: stdout ?? "" });
    });
  });
}

function isEasBuild(env) {
  return env.EAS_BUILD === "true" || env.EAS_BUILD === "1";
}

export async function assertProductionCheckout(run) {
  const inside = await run(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    throw new Error("production release check failed: git checkout is required");
  }
  const tracked = await run(["diff", "--quiet", "HEAD"]);
  if (tracked.code !== 0 && tracked.code !== 1) {
    throw new Error("production release check failed: tracked changes could not be read");
  }
  if (tracked.code !== 0) {
    throw new Error("production release check failed: tracked files differ from HEAD");
  }
  const fetched = await run(["fetch", "origin", "main"]);
  if (fetched.code !== 0) {
    throw new Error("production release check failed: could not fetch origin/main");
  }
  const shallow = await run(["rev-parse", "--is-shallow-repository"]);
  if (shallow.code !== 0) {
    throw new Error("production release check failed: could not read clone depth");
  }
  if (shallow.stdout.trim() === "true") {
    const deepened = await run(["fetch", "--unshallow", "origin", "main"]);
    if (deepened.code !== 0) {
      throw new Error("production release check failed: shallow clone could not be deepened to reach origin/main");
    }
  }
  const ancestor = await run(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  if (ancestor.code !== 0) throw new Error("production release check failed: HEAD is not on origin/main");
}

export async function checkRelease({ env, argv, run = execGit, stdout = (line) => process.stdout.write(`${line}\n`) }) {
  const profile = resolveProfile(env, argv);
  if (isEasBuild(env) && !KNOWN_PROFILES.has(profile)) {
    throw new Error("production release check failed: EAS build profile is missing or unknown");
  }
  if (profile !== "production") {
    stdout(`production release check skipped for profile ${profile || "unset"}`);
    return { ok: true, skipped: true };
  }
  await assertProductionCheckout(run);
  stdout("production release check passed");
  return { ok: true, skipped: false };
}

async function main() {
  try {
    await checkRelease({ env: process.env, argv: process.argv.slice(2) });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "production release check failed"}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
