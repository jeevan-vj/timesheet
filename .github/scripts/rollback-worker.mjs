import fs from "node:fs";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";

import { performRollback } from "./release-recovery.mjs";

function execWrangler(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error("wrangler rollback failed"));
        return;
      }
      resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
    });
  });
}

function flag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : "";
}

export async function rollbackFromRecoveryFile({
  recoveryPath,
  reason,
  dryRun,
  execImpl = execWrangler,
}) {
  const point = JSON.parse(fs.readFileSync(recoveryPath, "utf8"));
  return performRollback({
    versionId: point.version_id,
    bookmark: point.bookmark,
    reason,
    dryRun,
    execImpl,
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const result = await rollbackFromRecoveryFile({
    recoveryPath: flag(process.argv, "--recovery") || "release-recovery.json",
    reason: flag(process.argv, "--reason"),
    dryRun,
  });
  console.error(result.message);
  if (dryRun) console.error(`Dry run command: pnpm exec wrangler ${result.args.join(" ")}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Worker rollback failed");
    process.exitCode = 1;
  });
}
