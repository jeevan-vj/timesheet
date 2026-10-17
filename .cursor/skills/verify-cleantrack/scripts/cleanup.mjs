import fs from "node:fs";
import path from "node:path";
import { EVIDENCE, root, RUN, stopOwned } from "./lib.mjs";

stopOwned();

const devVarsPath = path.join(root, ".dev.vars");
const backupPath = path.join(RUN, "dev.vars.backup");
const createdFlag = path.join(RUN, "dev.vars.created");
if (fs.existsSync(backupPath)) {
  fs.copyFileSync(backupPath, devVarsPath);
  fs.rmSync(backupPath, { force: true });
} else if (fs.existsSync(createdFlag)) {
  fs.rmSync(devVarsPath, { force: true });
  fs.rmSync(createdFlag, { force: true });
}

const report = path.join(EVIDENCE, "REPORT.md");
const screenshot = path.join(EVIDENCE, "screenshots/sign-up.png");
process.stdout.write("cleanup stopped the launch process\n");
process.stdout.write(`evidence kept at ${EVIDENCE}\n`);
process.stdout.write(`report ${fs.existsSync(report) ? "present" : "absent"}\n`);
process.stdout.write(`screenshot ${fs.existsSync(screenshot) ? "present" : "absent"}\n`);
