import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { productionEasArgs, runProductionBuild } from "../apps/mobile/scripts/build-production.mjs";
import {
  assertProductionCheckout,
  assertTrackedContentMatchesHead,
  checkRelease,
  collectTrackedContentDiffs,
  execGit,
  formatTrackedDiffError,
  parseLsTreeZ,
  resolveProfile,
} from "../apps/mobile/scripts/check-release.mjs";

const MAIN_SHA = "0123456789abcdef0123456789abcdef01234567";

const README_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const NOTES_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function git(results, hashObject) {
  const run = vi.fn(async (args) => {
    if (args[0] === "hash-object") {
      if (hashObject) return hashObject(args);
      const result = results["hash-object"];
      if (!result) throw new Error(`unexpected git ${args.join(" ")}`);
      return result;
    }
    const key = args.join(" ");
    const result = results[key];
    if (!result) throw new Error(`unexpected git ${key}`);
    return result;
  });
  return run;
}

const clean = {
  "rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
  "rev-parse --show-toplevel": { code: 0, stdout: "/repo\n" },
  "ls-tree -r -z --full-tree HEAD": {
    code: 0,
    stdout: `100644 blob ${README_OID}\tREADME.md\0`,
  },
  "hash-object": { code: 0, stdout: `${README_OID}\n` },
  "fetch origin main": { code: 0, stdout: "" },
  "rev-parse --is-shallow-repository": { code: 0, stdout: "false\n" },
  "merge-base --is-ancestor HEAD origin/main": { code: 0, stdout: "" },
};

describe("mobile production release guard", () => {
  it("reads the production profile from EAS or the CLI", () => {
    expect(resolveProfile({ EAS_BUILD_PROFILE: "production" }, [])).toBe("production");
    expect(resolveProfile({ EAS_BUILD_PROFILE: "preview" }, ["--profile", "production"])).toBe("production");
    expect(resolveProfile({}, ["--profile=preview"])).toBe("preview");
    expect(resolveProfile({}, [])).toBe("");
  });

  it("skips development and preview builds, including on EAS", async () => {
    const run = vi.fn();
    const stdout = vi.fn();
    await expect(checkRelease({ env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "preview" }, argv: [], run, stdout })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    await expect(checkRelease({ env: {}, argv: [], run, stdout })).resolves.toEqual({
      ok: true,
      skipped: true,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails closed on EAS when the profile is missing or unknown", async () => {
    const run = vi.fn();
    await expect(checkRelease({ env: { EAS_BUILD: "true" }, argv: [], run, stdout: vi.fn() }))
      .rejects.toThrow("EAS build profile is missing or unknown");
    await expect(checkRelease({ env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "staging" }, argv: [], run, stdout: vi.fn() }))
      .rejects.toThrow("EAS build profile is missing or unknown");
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a clean commit that is on origin/main", async () => {
    const run = git(clean);
    await expect(assertProductionCheckout(run)).resolves.toBeUndefined();
    expect(run.mock.calls.map((call) => call[0].join(" "))).toEqual([
      "rev-parse --is-inside-work-tree",
      "rev-parse --show-toplevel",
      "ls-tree -r -z --full-tree HEAD",
      `hash-object -- /repo/README.md`,
      "fetch origin main",
      "rev-parse --is-shallow-repository",
      "merge-base --is-ancestor HEAD origin/main",
    ]);
  });

  it("ignores untracked files and file mode, and names content and missing paths", async () => {
    const untracked = git(clean);
    await expect(checkRelease({ env: { EAS_BUILD_PROFILE: "production" }, argv: [], run: untracked, stdout: vi.fn() }))
      .resolves.toEqual({ ok: true, skipped: false });
    expect(untracked.mock.calls.some((call) => call[0][0] === "status" || call[0][0] === "diff")).toBe(false);

    const tree = {
      ...clean,
      "ls-tree -r -z --full-tree HEAD": {
        code: 0,
        stdout: `100644 blob ${README_OID}\tREADME.md\0` + `100644 blob ${NOTES_OID}\tmy notes.txt\0`,
      },
    };
    const dirty = git(tree, (args) => {
      const files = args.slice(args.indexOf("--") + 1);
      if (files.length > 1) {
        return { code: 128, stdout: "", stderr: "fatal: could not open 'my notes.txt' for reading: No such file or directory\n" };
      }
      if (files[0].endsWith("README.md")) return { code: 0, stdout: `${NOTES_OID}\n`, stderr: "" };
      return { code: 128, stdout: "", stderr: "fatal: could not open 'my notes.txt' for reading: No such file or directory\n" };
    });
    await expect(checkRelease({ env: { EAS_BUILD_PROFILE: "production" }, argv: [], run: dirty, stdout: vi.fn() }))
      .rejects.toThrow("tracked files differ from HEAD\nREADME.md: content\nmy notes.txt: missing");
    expect(dirty.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);
  });

  it("ignores an executable-bit difference when the blob matches", () => {
    const entries = [{ path: "script.sh", oid: README_OID, mode: "100644", regular: true }];
    const worktree = new Map([["script.sh", { oid: README_OID, mode: "100755" }]]);
    expect(collectTrackedContentDiffs(entries, worktree)).toEqual([]);
  });

  it("names unsupported tracked types and unreadable files", async () => {
    expect(formatTrackedDiffError([{ path: "link", kind: "unsupported" }])).toBe(
      "production release check failed: tracked files differ from HEAD\nlink: unsupported",
    );
    const symlink = git({
      ...clean,
      "ls-tree -r -z --full-tree HEAD": { code: 0, stdout: `120000 blob ${README_OID}\tlink\0` },
    });
    await expect(assertTrackedContentMatchesHead(symlink)).rejects.toThrow("link: unsupported");
    expect(symlink.mock.calls.some((call) => call[0][0] === "hash-object")).toBe(false);

    const unreadable = git(clean, () => ({ code: 128, stdout: "", stderr: "fatal: could not open 'README.md' for reading: Permission denied\n" }));
    await expect(assertTrackedContentMatchesHead(unreadable)).rejects.toThrow("README.md: unreadable");
  });

  it("parses a NUL-separated tree and rejects a malformed record", () => {
    expect(parseLsTreeZ(`100644 blob ${README_OID}\tmy notes.txt\0`)).toEqual([
      { path: "my notes.txt", oid: README_OID, mode: "100644", regular: true },
    ]);
    expect(() => parseLsTreeZ("not a record\0")).toThrow("tracked changes could not be read");
  });

  it("deepens a shallow EAS clone before checking that HEAD is on origin/main", async () => {
    const shallow = git({
      ...clean,
      "rev-parse --is-shallow-repository": { code: 0, stdout: "true\n" },
      "fetch --unshallow origin main": { code: 0, stdout: "" },
    });
    await expect(assertProductionCheckout(shallow)).resolves.toBeUndefined();
    const commands = shallow.mock.calls.map((call) => call[0].join(" "));
    expect(commands.indexOf("fetch --unshallow origin main")).toBeLessThan(commands.indexOf("merge-base --is-ancestor HEAD origin/main"));

    const stuck = git({
      ...clean,
      "rev-parse --is-shallow-repository": { code: 0, stdout: "true\n" },
      "fetch --unshallow origin main": { code: 1, stdout: "" },
    });
    await expect(assertProductionCheckout(stuck)).rejects.toThrow("shallow clone could not be deepened to reach origin/main");
    expect(stuck.mock.calls.some((call) => call[0][0] === "merge-base")).toBe(false);
  });

  it("fails when origin/main cannot be fetched or HEAD is not on origin/main", async () => {
    const offline = git({ ...clean, "fetch origin main": { code: 1, stdout: "" } });
    await expect(assertProductionCheckout(offline)).rejects.toThrow("could not fetch origin/main");
    expect(offline.mock.calls.some((call) => call[0].includes("--unshallow"))).toBe(false);

    const branch = git({ ...clean, "merge-base --is-ancestor HEAD origin/main": { code: 1, stdout: "" } });
    await expect(assertProductionCheckout(branch)).rejects.toThrow("HEAD is not on origin/main");

    const missing = git({ "rev-parse --is-inside-work-tree": { code: 1, stdout: "" } });
    await expect(assertProductionCheckout(missing)).rejects.toThrow("git checkout is required");

    const broken = git({ ...clean, "ls-tree -r -z --full-tree HEAD": { code: 1, stdout: "" } });
    await expect(assertProductionCheckout(broken)).rejects.toThrow("tracked changes could not be read");
    expect(broken.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);
  });

  it("on an EAS worker checks the build commit and does not fetch when the remote is unreachable", async () => {
    const worker = git({
      ...clean,
      "fetch origin main": { code: 1, stdout: "", stderr: "could not read Username" },
      "rev-parse HEAD": { code: 0, stdout: `${MAIN_SHA}\n` },
    });
    await expect(
      checkRelease({
        env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "production", EAS_BUILD_GIT_COMMIT_HASH: MAIN_SHA.toUpperCase() },
        argv: [],
        run: worker,
        stdout: vi.fn(),
      }),
    ).resolves.toEqual({ ok: true, skipped: false });
    expect(worker.mock.calls.map((call) => call[0].join(" "))).toEqual([
      "rev-parse --is-inside-work-tree",
      "rev-parse --show-toplevel",
      "ls-tree -r -z --full-tree HEAD",
      "hash-object -- /repo/README.md",
      "rev-parse HEAD",
    ]);

    const missingHash = git(clean);
    await expect(
      checkRelease({
        env: { EAS_BUILD: "true", EAS_BUILD_PROFILE: "production" },
        argv: [],
        run: missingHash,
        stdout: vi.fn(),
      }),
    ).rejects.toThrow("EAS build commit hash is missing");
    expect(missingHash.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);

    const otherCommit = git({ ...clean, "rev-parse HEAD": { code: 0, stdout: `${MAIN_SHA}\n` } });
    await expect(
      checkRelease({
        env: {
          EAS_BUILD: "1",
          EAS_BUILD_PROFILE: "production",
          EAS_BUILD_GIT_COMMIT_HASH: "abcdef0123456789abcdef0123456789abcdef01",
          GITHUB_ACTIONS: "true",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SHA: MAIN_SHA,
        },
        argv: [],
        run: otherCommit,
        stdout: vi.fn(),
      }),
    ).rejects.toThrow("EAS build commit hash does not match HEAD");
    expect(otherCommit.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);
  });

  it("accepts the GitHub Actions main checkout without fetching", async () => {
    const actions = git({ ...clean, "rev-parse HEAD": { code: 0, stdout: `${MAIN_SHA}\n` } });
    await expect(
      assertProductionCheckout(actions, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main", GITHUB_SHA: MAIN_SHA }),
    ).resolves.toBeUndefined();
    expect(actions.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);

    const feature = git(clean);
    await expect(
      assertProductionCheckout(feature, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/feature", GITHUB_SHA: MAIN_SHA }),
    ).rejects.toThrow("HEAD is not on origin/main");
    expect(feature.mock.calls.some((call) => call[0][0] === "fetch" || call[0][0] === "rev-parse" && call[0][1] === "HEAD")).toBe(false);

    const moved = git({ ...clean, "rev-parse HEAD": { code: 0, stdout: `${MAIN_SHA}\n` } });
    await expect(
      assertProductionCheckout(moved, {
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SHA: "abcdef0123456789abcdef0123456789abcdef01",
      }),
    ).rejects.toThrow("HEAD is not the commit GitHub checked out from main");
    expect(moved.mock.calls.some((call) => call[0][0] === "fetch")).toBe(false);
  });
});

describe("production build wrapper", () => {
  it("checks main before spawning eas and forwards eas arguments", async () => {
    expect(productionEasArgs(["--", "--auto-submit", "--message", "GitHub Actions iOS production abc"])).toEqual([
      "build",
      "--platform",
      "ios",
      "--profile",
      "production",
      "--auto-submit",
      "--message",
      "GitHub Actions iOS production abc",
    ]);

    const spawnEas = vi.fn(async () => 0);
    const runCheck = vi.fn(async () => ({ ok: true, skipped: false }));
    await expect(
      runProductionBuild({
        env: { EAS_BUILD: "true", PATH: "/usr/bin", APP_VARIANT: "development" },
        argv: ["--", "--non-interactive"],
        runCheck,
        spawnEas,
      }),
    ).resolves.toBe(0);
    expect(runCheck).toHaveBeenCalledWith({ env: { PATH: "/usr/bin", APP_VARIANT: "development", EAS_BUILD_PROFILE: "production" }, argv: [] });
    expect(spawnEas).toHaveBeenCalledWith(
      ["build", "--platform", "ios", "--profile", "production", "--non-interactive"],
      { EAS_BUILD: "true", PATH: "/usr/bin", APP_VARIANT: "production" },
    );

    const blocked = vi.fn(async () => {
      throw new Error("production release check failed: HEAD is not on origin/main");
    });
    const eas = vi.fn();
    await expect(runProductionBuild({ env: {}, argv: [], runCheck: blocked, spawnEas: eas })).rejects.toThrow("HEAD is not on origin/main");
    expect(eas).not.toHaveBeenCalled();
  });
});

function gitOk(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || stdout || error.message));
      else resolve(stdout);
    });
  });
}

function runIn(cwd) {
  return (args, options = {}) => execGit(args, { ...options, cwd });
}

async function withRepo(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), "ct-release-"));
  try {
    await gitOk(dir, ["init", "-b", "main"]);
    await gitOk(dir, ["config", "core.filemode", "true"]);
    await mkdir(path.join(dir, "dir"));
    await writeFile(path.join(dir, "a.txt"), "hello\n");
    await writeFile(path.join(dir, "dir", "b.txt"), "nested\n");
    await gitOk(dir, ["add", "a.txt", "dir/b.txt"]);
    await gitOk(dir, ["-c", "user.email=dev@example.com", "-c", "user.name=Dev", "commit", "-m", "init"]);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("mobile production release guard against a real checkout", () => {
  it("passes an EAS-style clone whose index is empty while git diff reports deletions", async () => {
    await withRepo(async (repo) => {
      const packed = await mkdtemp(path.join(tmpdir(), "ct-eas-"));
      try {
        await gitOk(repo, ["clone", "--no-checkout", "--no-hardlinks", "--depth", "1", repo, packed]);
        await copyFile(path.join(repo, "a.txt"), path.join(packed, "a.txt"));
        await mkdir(path.join(packed, "dir"));
        await copyFile(path.join(repo, "dir", "b.txt"), path.join(packed, "dir", "b.txt"));
        const diff = await execGit(["diff", "--quiet", "HEAD"], { cwd: packed });
        expect(diff.code).toBe(1);
        const raw = await execGit(["diff", "--raw", "HEAD"], { cwd: packed });
        expect(raw.stdout).toMatch(/:100644 000000 .* D\ta\.txt/);
        await expect(assertTrackedContentMatchesHead(runIn(packed))).resolves.toBeUndefined();
      } finally {
        await rm(packed, { recursive: true, force: true });
      }
    });
  });

  it("passes mode-only changes and fails on content, missing files, and line endings", async () => {
    await withRepo(async (repo) => {
      const run = runIn(repo);
      await chmod(path.join(repo, "a.txt"), 0o755);
      const modeDiff = await execGit(["diff", "--summary", "HEAD"], { cwd: repo });
      expect(modeDiff.stdout).toMatch(/mode change 100644 => 100755 a\.txt/);
      await expect(assertTrackedContentMatchesHead(run)).resolves.toBeUndefined();

      await chmod(path.join(repo, "a.txt"), 0o644);
      await execGit(["checkout", "--", "a.txt"], { cwd: repo });
      await writeFile(path.join(repo, "extra.txt"), "untracked\n");
      await expect(assertTrackedContentMatchesHead(run)).resolves.toBeUndefined();

      await writeFile(path.join(repo, "dir", "b.txt"), "nested\r\n");
      await expect(assertTrackedContentMatchesHead(run)).rejects.toThrow("dir/b.txt: content");

      await writeFile(path.join(repo, "dir", "b.txt"), "changed\n");
      await expect(assertTrackedContentMatchesHead(run)).rejects.toThrow("dir/b.txt: content");

      await rm(path.join(repo, "a.txt"));
      await expect(assertTrackedContentMatchesHead(run)).rejects.toThrow("a.txt: missing");
    });
  });

  it("checks blob bytes from a subdirectory of the checkout", async () => {
    await withRepo(async (repo) => {
      const nested = path.join(repo, "dir");
      await expect(assertTrackedContentMatchesHead(runIn(nested))).resolves.toBeUndefined();
      await writeFile(path.join(repo, "a.txt"), "edited outside the hook directory\n");
      await expect(assertTrackedContentMatchesHead(runIn(nested))).rejects.toThrow("a.txt: content");
    });
  });
});
