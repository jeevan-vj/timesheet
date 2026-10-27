import { execFile } from "node:child_process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
  activeVersionId,
  buildRecoveryPoint,
  formatRecoverySummary,
  parseJsonObject,
  parseTimeTravelInfo,
} from "./release-recovery.mjs";

function execWrangler(args) {
  return new Promise((resolve, reject) => {
    execFile("pnpm", ["exec", "wrangler", ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        reject(new Error(`wrangler ${args.slice(0, 3).join(" ")} failed`));
        return;
      }
      resolve(stdout ?? "");
    });
  });
}

export async function recordRecoveryPoint({
  wrangler = execWrangler,
  gitSha = process.env.GITHUB_SHA,
  recordedAt = new Date().toISOString(),
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  const info = await wrangler([
    "d1",
    "time-travel",
    "info",
    "cleantrack-timesheet",
    "--json",
    "--config",
    "wrangler.jsonc",
  ]);
  const { bookmark } = parseTimeTravelInfo(info);
  const status = parseJsonObject(await wrangler([
    "deployments",
    "status",
    "--name",
    "cleantrack-timesheet",
    "--json",
  ]));
  const point = buildRecoveryPoint({
    bookmark,
    versionId: activeVersionId(status),
    gitSha,
    recordedAt,
  });
  if (summaryPath) fs.appendFileSync(summaryPath, formatRecoverySummary(point));
  return point;
}

function outputPath(argv) {
  const index = argv.indexOf("--out");
  const file = index >= 0 ? argv[index + 1] : "";
  if (!file || file.startsWith("-") || file.includes("\0")) throw new Error("Recovery output path is missing");
  return file;
}

async function main() {
  const point = await recordRecoveryPoint();
  fs.writeFileSync(outputPath(process.argv), `${JSON.stringify(point, null, 2)}\n`);
  console.log(`Recorded D1 bookmark and Worker version ${point.version_id}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Could not record the recovery point");
    process.exitCode = 1;
  });
}
