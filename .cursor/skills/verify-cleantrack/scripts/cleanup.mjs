import fs from "node:fs";
import path from "node:path";
import { cleanupVerifyEnv } from "./dev-vars.mjs";
import { EVIDENCE, root, RUN, stopOwned } from "./lib.mjs";

stopOwned();
cleanupVerifyEnv({ rootDir: root, runDir: RUN });

const report = path.join(EVIDENCE, "REPORT.md");
const screenshot = path.join(EVIDENCE, "screenshots/sign-up.png");
process.stdout.write("cleanup stopped the launch process\n");
process.stdout.write(`evidence kept at ${EVIDENCE}\n`);
process.stdout.write(`report ${fs.existsSync(report) ? "present" : "absent"}\n`);
process.stdout.write(`screenshot ${fs.existsSync(screenshot) ? "present" : "absent"}\n`);
