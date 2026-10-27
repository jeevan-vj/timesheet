import { describe, expect, it, vi } from "vitest";

import { assertProductionCheckout, checkRelease, resolveProfile } from "../apps/mobile/scripts/check-release.mjs";

function git(results) {
  const run = vi.fn(async (args) => {
    const key = args.join(" ");
    const result = results[key];
    if (!result) throw new Error(`unexpected git ${key}`);
    return result;
  });
  return run;
}

const clean = {
  "rev-parse --is-inside-work-tree": { code: 0, stdout: "true\n" },
  "diff --quiet HEAD": { code: 0, stdout: "" },
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
      "diff --quiet HEAD",
      "fetch origin main",
      "rev-parse --is-shallow-repository",
      "merge-base --is-ancestor HEAD origin/main",
    ]);
  });

  it("ignores untracked files and fails when tracked files differ from HEAD", async () => {
    const untracked = git(clean);
    await expect(checkRelease({ env: { EAS_BUILD_PROFILE: "production" }, argv: [], run: untracked, stdout: vi.fn() }))
      .resolves.toEqual({ ok: true, skipped: false });
    expect(untracked.mock.calls.some((call) => call[0][0] === "status")).toBe(false);

    const dirty = git({ ...clean, "diff --quiet HEAD": { code: 1, stdout: "" } });
    await expect(checkRelease({ env: { EAS_BUILD_PROFILE: "production" }, argv: [], run: dirty, stdout: vi.fn() }))
      .rejects.toThrow("tracked files differ from HEAD");
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
  });
});
