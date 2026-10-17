import fs from "node:fs";
import path from "node:path";
import { assertLocal, BASE_URL, EVIDENCE } from "./lib.mjs";

assertLocal();
const featureFlag = process.argv.indexOf("--feature");
const feature = featureFlag === -1 ? "" : process.argv[featureFlag + 1];
if (feature !== "sign-up") {
  process.stderr.write("drive: pass --feature sign-up. Other journeys are in features/ and fail closed without their seed.\n");
  process.exit(1);
}

const password = "VerifyCleantrack1";
const email = `owner.${Date.now()}@example.test`;
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
fs.mkdirSync(path.join(EVIDENCE, "screenshots"), { recursive: true });
const screenshot = path.join(EVIDENCE, "screenshots/sign-up.png");
try {
  await page.goto(`${BASE_URL}/sign-up`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Verify Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard(?:\/|$|\?)/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "Hours & contractor pay" }).waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { name: "Add your business" }).waitFor({ timeout: 30_000 });
  await page.getByRole("heading", { name: "No shifts this week" }).waitFor({ timeout: 30_000 });
  const dashboard = await page.request.get(`${BASE_URL}/api/dashboard`);
  const body = await dashboard.json().catch(() => ({}));
  if (dashboard.status() !== 200 || body.business !== null) {
    throw new Error(`dashboard after signup was ${dashboard.status()} business=${body.business === null ? "null" : "present"}`);
  }
  await page.screenshot({ path: screenshot, fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, "drive.json"), `${JSON.stringify({
    feature: "sign-up",
    path: "/dashboard",
    headings: ["Hours & contractor pay", "Add your business", "No shifts this week"],
    dashboardStatus: 200,
    business: null,
    screenshot: "screenshots/sign-up.png",
  }, null, 2)}\n`);
  process.stdout.write("drive sign-up ok\n");
} catch (error) {
  await page.screenshot({ path: path.join(EVIDENCE, "screenshots/sign-up-failure.png"), fullPage: true }).catch(() => {});
  process.stderr.write(`${error instanceof Error ? error.message : "drive failed"}\n`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
