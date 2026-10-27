import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const KNOWN_PROFILES = new Set(["development", "preview", "production"]);
const REGULAR_FILE_MODES = new Set(["100644", "100755"]);
const HASH_CHUNK = 100;
const COMMIT_SHA = /^[a-f0-9]{40}$/;

export function resolveProfile(env, argv) {
  const inline = argv.find((arg) => arg.startsWith("--profile="));
  if (inline) return inline.slice("--profile=".length);
  const index = argv.indexOf("--profile");
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return env.EAS_BUILD_PROFILE ?? "";
}

export function execGit(args, options = {}) {
  return new Promise((resolve) => {
    const execOptions = { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 };
    if (options.cwd) execOptions.cwd = options.cwd;
    execFile("git", args, execOptions, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
      resolve({ code, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function gitFailure(message) {
  return new Error(`production release check failed: ${message}`);
}

function isEasBuild(env) {
  return env.EAS_BUILD === "true" || env.EAS_BUILD === "1";
}

function normalizeSha(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function readHead(run) {
  const head = await run(["rev-parse", "HEAD"]);
  const sha = normalizeSha(head.stdout);
  if (head.code !== 0 || !COMMIT_SHA.test(sha)) throw gitFailure("could not read HEAD");
  return sha;
}

export function parseLsTreeZ(stdout) {
  const entries = [];
  for (const record of stdout.split("\0")) {
    if (record === "") continue;
    const match = /^([0-7]{6}) (\S+) ([0-9a-f]+)\t([\s\S]*)$/.exec(record);
    if (!match) throw gitFailure("tracked changes could not be read");
    const [, mode, type, oid, filePath] = match;
    entries.push({
      path: filePath,
      oid,
      mode,
      regular: type === "blob" && REGULAR_FILE_MODES.has(mode),
    });
  }
  return entries;
}

export function collectTrackedContentDiffs(entries, worktree) {
  const diffs = [];
  for (const entry of entries) {
    if (!entry.regular) {
      diffs.push({ path: entry.path, kind: "unsupported" });
      continue;
    }
    const found = worktree.get(entry.path);
    if (!found || found.missing) diffs.push({ path: entry.path, kind: "missing" });
    else if (found.unreadable) diffs.push({ path: entry.path, kind: "unreadable" });
    else if (found.oid !== entry.oid) diffs.push({ path: entry.path, kind: "content" });
  }
  return diffs;
}

export function formatTrackedDiffError(diffs) {
  const lines = diffs.map((diff) => `${diff.path}: ${diff.kind}`);
  return `production release check failed: tracked files differ from HEAD\n${lines.join("\n")}`;
}

function isMissingFile(result) {
  return /No such file or directory/i.test(result.stderr ?? "");
}

function oidsFromHashOutput(stdout, expected) {
  const oids = (stdout ?? "").split("\n").filter((line) => line.length > 0);
  if (oids.length !== expected) throw gitFailure("tracked changes could not be read");
  return oids;
}

function recordHashResult(worktree, entry, result) {
  if (result.code === 0) worktree.set(entry.path, { oid: result.stdout.trim() });
  else if (isMissingFile(result)) worktree.set(entry.path, { missing: true });
  else worktree.set(entry.path, { unreadable: true });
}

async function hashRegularFiles(run, root, entries) {
  const regular = entries.filter((entry) => entry.regular);
  const worktree = new Map();
  for (let offset = 0; offset < regular.length; offset += HASH_CHUNK) {
    const chunk = regular.slice(offset, offset + HASH_CHUNK);
    const absolute = chunk.map((entry) => path.join(root, entry.path));
    const hashed = await run(["hash-object", "--", ...absolute]);
    if (hashed.code === 0) {
      const oids = oidsFromHashOutput(hashed.stdout, chunk.length);
      chunk.forEach((entry, index) => worktree.set(entry.path, { oid: oids[index] }));
      continue;
    }
    for (const entry of chunk) {
      const one = chunk.length === 1 ? hashed : await run(["hash-object", "--", path.join(root, entry.path)]);
      recordHashResult(worktree, entry, one);
    }
  }
  return worktree;
}

// Index state and file mode are not content. Compare blob bytes to HEAD.
export async function assertTrackedContentMatchesHead(run) {
  const rootResult = await run(["rev-parse", "--show-toplevel"]);
  if (rootResult.code !== 0 || rootResult.stdout.trim() === "") {
    throw gitFailure("tracked changes could not be read");
  }
  const tree = await run(["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
  if (tree.code !== 0) throw gitFailure("tracked changes could not be read");
  const entries = parseLsTreeZ(tree.stdout);
  const worktree = await hashRegularFiles(run, rootResult.stdout.trim(), entries);
  const diffs = collectTrackedContentDiffs(entries, worktree);
  if (diffs.length > 0) throw new Error(formatTrackedDiffError(diffs));
}

export async function assertHeadMatchesEasCommit(run, env) {
  const expected = normalizeSha(env.EAS_BUILD_GIT_COMMIT_HASH);
  if (!COMMIT_SHA.test(expected)) throw gitFailure("EAS build commit hash is missing");
  const actual = await readHead(run);
  if (actual !== expected) throw gitFailure("EAS build commit hash does not match HEAD");
}

export async function assertHeadOnOriginMain(run, env = {}) {
  if (env.GITHUB_ACTIONS === "true") {
    if (env.GITHUB_REF !== "refs/heads/main") throw gitFailure("HEAD is not on origin/main");
    const expected = normalizeSha(env.GITHUB_SHA);
    if (!COMMIT_SHA.test(expected)) throw gitFailure("HEAD is not on origin/main");
    const actual = await readHead(run);
    if (actual !== expected) throw gitFailure("HEAD is not the commit GitHub checked out from main");
    return;
  }
  const fetched = await run(["fetch", "origin", "main"]);
  if (fetched.code !== 0) {
    throw gitFailure("could not fetch origin/main");
  }
  const shallow = await run(["rev-parse", "--is-shallow-repository"]);
  if (shallow.code !== 0) {
    throw gitFailure("could not read clone depth");
  }
  if (shallow.stdout.trim() === "true") {
    const deepened = await run(["fetch", "--unshallow", "origin", "main"]);
    if (deepened.code !== 0) {
      throw gitFailure("shallow clone could not be deepened to reach origin/main");
    }
  }
  const ancestor = await run(["merge-base", "--is-ancestor", "HEAD", "origin/main"]);
  if (ancestor.code !== 0) throw gitFailure("HEAD is not on origin/main");
}

// The EAS worker cannot reach a private GitHub remote. It checks blob bytes and
// EAS_BUILD_GIT_COMMIT_HASH. The origin/main check runs before upload.
export async function assertProductionCheckout(run, env = {}) {
  const inside = await run(["rev-parse", "--is-inside-work-tree"]);
  if (inside.code !== 0 || inside.stdout.trim() !== "true") {
    throw gitFailure("git checkout is required");
  }
  await assertTrackedContentMatchesHead(run);
  if (isEasBuild(env)) {
    await assertHeadMatchesEasCommit(run, env);
    return;
  }
  await assertHeadOnOriginMain(run, env);
}

export async function checkRelease({ env, argv, run = execGit, stdout = (line) => process.stdout.write(`${line}\n`) }) {
  const profile = resolveProfile(env, argv);
  if (isEasBuild(env) && !KNOWN_PROFILES.has(profile)) {
    throw gitFailure("EAS build profile is missing or unknown");
  }
  if (profile !== "production") {
    stdout(`production release check skipped for profile ${profile || "unset"}`);
    return { ok: true, skipped: true };
  }
  await assertProductionCheckout(run, env);
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
