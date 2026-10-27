import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { rollbackFromRecoveryFile } from "../.github/scripts/rollback-worker.mjs";
import { recordRecoveryPoint } from "../.github/scripts/record-recovery-point.mjs";
import {
  activeVersionId,
  formatRecoverySummary,
  parseTimeTravelInfo,
  performRollback,
  shouldRollback,
} from "../.github/scripts/release-recovery.mjs";

const bookmark = "00000085-0000024c-00004c6d-8e61117bf38d7adb71b934ebbf891683";
const versionId = "10000000-0000-4000-8000-000000000001";
const gitSha = "a".repeat(40);

describe("release recovery and rollback", () => {
  it("parses the D1 bookmark and the Worker version at 100 percent", () => {
    expect(parseTimeTravelInfo(JSON.stringify({ bookmark }))).toEqual({ bookmark });
    expect(parseTimeTravelInfo(`⚠️ The current bookmark is '${bookmark}'`)).toEqual({ bookmark });
    expect(activeVersionId({
      versions: [
        { version_id: "20000000-0000-4000-8000-000000000002", percentage: 0 },
        { version_id: versionId, percentage: 100 },
      ],
    })).toBe(versionId);
  });

  it("writes the bookmark and pre-deploy version into the summary", async () => {
    const summary = path.join(os.tmpdir(), `recovery-summary-${process.pid}.md`);
    const point = await recordRecoveryPoint({
      wrangler: async (args) => {
        expect(args).not.toContain("restore");
        if (args[0] === "d1") return JSON.stringify({ bookmark });
        return JSON.stringify({ versions: [{ version_id: versionId, percentage: 100 }] });
      },
      gitSha,
      recordedAt: "2026-10-27T00:00:00.000Z",
      summaryPath: summary,
    });
    const text = fs.readFileSync(summary, "utf8");
    expect(point.bookmark).toBe(bookmark);
    expect(point.version_id).toBe(versionId);
    expect(text).toBe(formatRecoverySummary(point));
    expect(text).toContain(bookmark);
    expect(text).toContain("does not restore D1");
    fs.unlinkSync(summary);
  });

  it("rolls the Worker back only after identity or smoke failure and never restores D1", async () => {
    expect(shouldRollback({ identityOutcome: "failure", smokeOutcome: "skipped" })).toBe(true);
    expect(shouldRollback({ identityOutcome: "success", smokeOutcome: "failure" })).toBe(true);
    expect(shouldRollback({ identityOutcome: "success", smokeOutcome: "success" })).toBe(false);
    expect(shouldRollback({ identityOutcome: "skipped", smokeOutcome: "skipped" })).toBe(false);

    const execImpl = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const result = await performRollback({
      versionId,
      bookmark,
      reason: "smoke",
      execImpl,
    });

    expect(execImpl).toHaveBeenCalledOnce();
    expect(execImpl.mock.calls[0][0]).toBe("pnpm");
    expect(execImpl.mock.calls[0][1]).toEqual([
      "exec",
      "wrangler",
      "rollback",
      versionId,
      "--name",
      "cleantrack-timesheet",
      "--message",
      "Automatic rollback after failed post-deploy verification",
      "--yes",
    ]);
    expect(execImpl.mock.calls[0][1].join(" ")).not.toMatch(/time-travel|restore|\bd1\b/);
    expect(result.rollbackStatus).toBe("rolled-back");
    expect(result.message).toContain(bookmark);
    expect(result.message).toContain("D1 was not restored");

    const dry = await performRollback({
      versionId,
      bookmark,
      reason: "identity",
      execImpl,
      dryRun: true,
    });
    expect(execImpl).toHaveBeenCalledOnce();
    expect(dry.rollbackStatus).toBe("dry-run");
    expect(dry.message).toContain(bookmark);

    await expect(performRollback({
      versionId,
      bookmark,
      reason: "deploy",
      execImpl,
      dryRun: true,
    })).rejects.toThrow("only after the identity check or the smoke test");
    expect(execImpl).toHaveBeenCalledOnce();
  });

  it("dry-runs the rollback command from a recovery file", async () => {
    const recovery = path.join(os.tmpdir(), `recovery-${process.pid}.json`);
    fs.writeFileSync(recovery, JSON.stringify({ bookmark, version_id: versionId }));
    const execImpl = vi.fn();
    const result = await rollbackFromRecoveryFile({
      recoveryPath: recovery,
      reason: "identity",
      dryRun: true,
      execImpl,
    });
    expect(execImpl).not.toHaveBeenCalled();
    expect(result.args[0]).toBe("rollback");
    expect(result.args).not.toContain("restore");
    expect(result.message).toContain(`D1 Time Travel bookmark (not restored): ${bookmark}`);
    fs.unlinkSync(recovery);
  });
});
