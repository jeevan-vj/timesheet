export const DATABASE_NAME = "cleantrack-timesheet";
export const WORKER_NAME = "cleantrack-timesheet";

const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GIT_SHA = /^[0-9a-f]{40}$/i;
const BOOKMARK = /^[0-9a-f-]{16,128}$/i;

export function assertVersionId(versionId) {
  if (typeof versionId !== "string" || !VERSION_ID.test(versionId)) {
    throw new Error("Refusing to roll back without a Worker version id");
  }
  return versionId;
}

export function assertBookmark(bookmark) {
  if (typeof bookmark !== "string" || !BOOKMARK.test(bookmark)) {
    throw new Error("D1 bookmark is missing");
  }
  return bookmark;
}

export function parseJsonObject(stdout) {
  const trimmed = String(stdout).trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Wrangler did not return JSON");
  return JSON.parse(trimmed.slice(start, end + 1));
}

export function parseTimeTravelInfo(stdout) {
  const trimmed = String(stdout).trim();
  try {
    const bookmark = bookmarkFrom(parseJsonObject(trimmed));
    if (bookmark) return { bookmark: assertBookmark(bookmark) };
  } catch (error) {
    if (error instanceof Error && error.message === "D1 bookmark is missing") throw error;
  }
  const quoted = trimmed.match(/The current bookmark is '([^']+)'/);
  if (quoted?.[1]) return { bookmark: assertBookmark(quoted[1]) };
  throw new Error("D1 time-travel info did not include a bookmark");
}

function bookmarkFrom(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.bookmark === "string") return value.bookmark.trim();
  if (value.result) return bookmarkFrom(value.result);
  return null;
}

export function activeVersionId(status) {
  const versions = Array.isArray(status)
    ? status.flatMap((item) => item?.versions ?? [])
    : status?.versions ?? [];
  const active = versions.find((item) => item?.percentage === 100 && typeof item.version_id === "string");
  if (!active) throw new Error("No Worker version is at 100%");
  return assertVersionId(active.version_id);
}

export function buildRecoveryPoint({ bookmark, versionId, gitSha, recordedAt }) {
  if (typeof gitSha !== "string" || !GIT_SHA.test(gitSha)) throw new Error("Git SHA is missing");
  if (typeof recordedAt !== "string" || recordedAt.trim() === "") throw new Error("Recovery timestamp is missing");
  return {
    database: DATABASE_NAME,
    bookmark: assertBookmark(bookmark),
    worker: WORKER_NAME,
    version_id: assertVersionId(versionId),
    git_sha: gitSha,
    recorded_at: recordedAt,
  };
}

export function formatRecoverySummary(point) {
  return [
    "### Pre-deploy recovery point",
    "",
    `- D1 database: \`${point.database}\``,
    `- D1 Time Travel bookmark: \`${point.bookmark}\``,
    `- Worker \`${point.worker}\` version at 100%: \`${point.version_id}\``,
    `- Git SHA: \`${point.git_sha}\``,
    "",
    "This workflow records the bookmark and does not restore D1.",
    "To restore manually after you decide the database should move back:",
    "",
    "```",
    `pnpm exec wrangler d1 time-travel restore ${point.database} --bookmark=${point.bookmark}`,
    "```",
    "",
  ].join("\n");
}

export function rollbackArgs(versionId) {
  return [
    "rollback",
    assertVersionId(versionId),
    "--name",
    WORKER_NAME,
    "--message",
    "Automatic rollback after failed post-deploy verification",
    "--yes",
  ];
}

export function assertWorkerRollbackArgs(args) {
  const joined = args.join("\n");
  if (/\btime-travel\b|\brestore\b|\bd1\b/i.test(joined)) {
    throw new Error("Refusing to restore D1 from the Worker rollback");
  }
  if (args[0] !== "rollback") throw new Error("Worker rollback command is incomplete");
  return args;
}

export function shouldRollback({ identityOutcome, smokeOutcome }) {
  return identityOutcome === "failure" || smokeOutcome === "failure";
}

export function formatRollbackFailure({ bookmark, versionId, rollbackStatus }) {
  const safeBookmark = assertBookmark(bookmark);
  const safeVersion = assertVersionId(versionId);
  return [
    `Post-deploy verification failed. Worker rollback status: ${rollbackStatus}.`,
    `Previous Worker version: ${safeVersion}`,
    `D1 Time Travel bookmark (not restored): ${safeBookmark}`,
    "D1 was not restored. Restore it manually only if the database should move back:",
    `pnpm exec wrangler d1 time-travel restore ${DATABASE_NAME} --bookmark=${safeBookmark}`,
  ].join("\n");
}

export function assertRollbackReason(reason) {
  if (reason !== "identity" && reason !== "smoke") {
    throw new Error("Worker rollback runs only after the identity check or the smoke test fails");
  }
  return reason;
}

export async function performRollback({ versionId, bookmark, reason, execImpl, dryRun = false }) {
  assertRollbackReason(reason);
  const args = assertWorkerRollbackArgs(rollbackArgs(versionId));
  let rollbackStatus = "dry-run";
  if (!dryRun) {
    try {
      await execImpl("pnpm", ["exec", "wrangler", ...args]);
      rollbackStatus = "rolled-back";
    } catch {
      rollbackStatus = "rollback-failed";
    }
  }
  return {
    rollbackStatus,
    args,
    message: formatRollbackFailure({ bookmark, versionId, rollbackStatus }),
  };
}
