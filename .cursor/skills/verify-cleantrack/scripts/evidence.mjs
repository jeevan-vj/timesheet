import fs from "node:fs";
import path from "node:path";
import { assertLocal, countRows, EVIDENCE } from "./lib.mjs";

assertLocal();
const drivePath = path.join(EVIDENCE, "drive.json");
const screenshot = path.join(EVIDENCE, "screenshots/sign-up.png");
if (!fs.existsSync(drivePath) || !fs.existsSync(screenshot)) {
  process.stderr.write("evidence: sign-up drive did not leave a screenshot\n");
  process.exit(1);
}
const drive = JSON.parse(fs.readFileSync(drivePath, "utf8"));
const counts = countRows();
const ok = drive.feature === "sign-up"
  && drive.dashboardStatus === 200
  && drive.business === null
  && counts.user_count === 1
  && counts.session_count >= 1
  && counts.business_count === 0;
const evidence = {
  feature: "sign-up",
  action: "Create account on /sign-up",
  resultingPath: drive.path,
  headings: drive.headings,
  dashboardStatus: drive.dashboardStatus,
  business: drive.business,
  counts,
  screenshot: drive.screenshot,
  ok,
};
fs.writeFileSync(path.join(EVIDENCE, "evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
fs.writeFileSync(path.join(EVIDENCE, "REPORT.md"), [
  "# Sign-up evidence",
  "",
  `Action: Create account on /sign-up, then open /dashboard.`,
  `Headings: ${drive.headings.join("; ")}.`,
  `GET /api/dashboard: ${drive.dashboardStatus}, business ${drive.business === null ? "null" : "present"}.`,
  `Local D1 counts: user ${counts.user_count}, session ${counts.session_count}, business ${counts.business_count}.`,
  `Screenshot: ${drive.screenshot}.`,
  `Result: ${ok ? "pass" : "fail"}.`,
  "",
].join("\n"));
if (!ok) {
  process.stderr.write("evidence: signup side effects did not match\n");
  process.exit(1);
}
process.stdout.write(`evidence ok ${path.relative(process.cwd(), path.join(EVIDENCE, "REPORT.md"))}\n`);
