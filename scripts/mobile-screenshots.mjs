import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const valueAfter = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseUrl = valueAfter("--base-url", process.env.MOBILE_E2E_BASE_URL || "http://127.0.0.1:8787");
const outputDir = path.resolve(valueAfter("--out", "docs/verification/mobile/after"));
const checkOnly = args.includes("--check-only");
const baseUrlHost = (() => {
  try {
    return new URL(baseUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error(`MOBILE_E2E_BASE_URL/--base-url must be a valid URL; received "${baseUrl}".`);
  }
})();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
if (!loopbackHosts.has(baseUrlHost) && process.env.MOBILE_E2E_ALLOW_REMOTE_DISPOSABLE !== "1") {
  throw new Error(
    `Refusing to sign up and seed data against non-loopback host "${baseUrlHost}". `
    + "Use localhost, 127.0.0.1, or ::1, or explicitly set MOBILE_E2E_ALLOW_REMOTE_DISPOSABLE=1 for a disposable remote environment.",
  );
}
const devices = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-13", width: 390, height: 844 },
  { name: "iphone-14-pro-max", width: 430, height: 932 },
];

if (!checkOnly) fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });

function mondayInAuckland() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

async function assertNoOverflow(page, label, device) {
  const sizes = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  if (sizes.scrollWidth > sizes.innerWidth) {
    throw new Error(`${device.name} ${label}: scrollWidth ${sizes.scrollWidth} > innerWidth ${sizes.innerWidth}`);
  }
  console.log(`PASS ${device.name} ${label} scrollWidth=${sizes.scrollWidth} viewport=${sizes.innerWidth}`);
}

async function capture(page, filename) {
  if (!checkOnly) await page.screenshot({ path: path.join(outputDir, filename) });
}

async function captureAuth(device) {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height } });
  const page = await context.newPage();
  for (const route of ["sign-in", "sign-up"]) {
    await page.goto(`${baseUrl}/${route}`, { waitUntil: "domcontentloaded" });
    await page.locator(".auth-card").waitFor();
    await assertNoOverflow(page, route, device);
    if (!checkOnly) await page.screenshot({ path: path.join(outputDir, `${route}-${device.name}.png`), fullPage: true });
  }
  await context.close();
}

for (const device of devices) await captureAuth(device);

const setupContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const setupPage = await setupContext.newPage();
const email = `mobile.${Date.now()}@example.test`;
await setupPage.goto(`${baseUrl}/sign-up`, { waitUntil: "domcontentloaded" });
await setupPage.getByLabel("Your name").fill("Demo Owner");
await setupPage.getByLabel("Email").fill(email);
await setupPage.getByLabel("Password").fill("CleanTrackDemoPass1");
await setupPage.getByRole("button", { name: "Create account" }).click();
await setupPage.waitForFunction(() => window.location.pathname === "/dashboard", undefined, { timeout: 30_000 });

async function api(pathname, body, method = "POST") {
  return setupPage.evaluate(async ({ pathname, body, method }) => {
    const response = await fetch(pathname, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${pathname}:${response.status}:${data.error ?? "request_failed"}`);
    return data;
  }, { pathname, body, method });
}

await api("/api/business", {
  name: "Demo Cleaning Co",
  nzbn: "",
  address: "",
  contactEmail: email,
  contactPhone: "",
  timezone: "Pacific/Auckland",
  currency: "NZD",
  weekStart: "monday",
});
const north = await api("/api/sites", { name: "Demo Site North", address: "" });
const south = await api("/api/sites", { name: "Demo Site South", address: "" });
const alex = await api("/api/contractors", { name: "Alex Sample", email: "", phone: "", defaultRateCents: 3200 });
const sam = await api("/api/contractors", { name: "Sam Placeholder", email: "", phone: "", defaultRateCents: 3000 });
const alexNorth = await api("/api/assignments", { contractorId: alex.id, siteId: north.id, rateCents: null });
const samSouth = await api("/api/assignments", { contractorId: sam.id, siteId: south.id, rateCents: null });
await api("/api/assignments", { contractorId: alex.id, siteId: south.id, rateCents: null });
const weekStart = mondayInAuckland();
for (const [assignmentId, paidMinutes] of [[alexNorth.id, 45], [samSouth.id, 60]]) {
  await api(`/api/assignments/${assignmentId}/schedule`, {
    weekdays: [1, 2, 3, 4, 5], paidMinutes, weekStart, fromDate: weekStart, mode: "create",
  }, "PUT");
}
await api("/api/business/onboarding/complete");
const storageState = await setupContext.storageState();
await setupContext.close();

async function bringIntoView(target) {
  await target.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await target.page().waitForTimeout(100);
}

for (const device of devices) {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, storageState });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Hours & contractor pay" }).waitFor();
  await page.locator(".week-grid-mobile").getByText("45m", { exact: true }).first().waitFor({ timeout: 30_000 });

  const weeklyPanel = page.locator("section.panel").filter({ has: page.locator(".week-grid-mobile") });
  await bringIntoView(weeklyPanel);
  await assertNoOverflow(page, "weekly-grid", device);
  if (!checkOnly) await weeklyPanel.screenshot({ path: path.join(outputDir, `weekly-grid-${device.name}.png`) });

  await page.getByRole("button", { name: "+ Add shift" }).click();
  await page.getByRole("dialog", { name: "Add a completed shift" }).waitFor();
  await assertNoOverflow(page, "add-shift", device);
  await capture(page, `add-shift-${device.name}.png`);
  await page.getByRole("button", { name: "Close shift form" }).click();

  await page.getByRole("button", { name: "Add repeating schedule" }).click();
  const picker = page.getByRole("dialog", { name: "Add repeating schedule" });
  await picker.waitFor();
  await assertNoOverflow(page, "add-schedule-picker", device);
  await capture(page, `add-schedule-picker-${device.name}.png`);
  await picker.getByLabel("Assignment").selectOption({ label: "Alex Sample — Demo Site South" });
  await picker.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("dialog", { name: "Add repeating schedule" }).waitFor();
  await assertNoOverflow(page, "add-schedule", device);
  await capture(page, `add-schedule-${device.name}.png`);
  await page.getByRole("button", { name: "Close schedule editor" }).click();

  const sections = [
    ["payment-summary", page.locator(".summary-panel")],
    ["sites", page.locator(".setup-card").filter({ has: page.getByRole("heading", { name: "Sites" }) })],
    ["contractors", page.locator(".setup-card").filter({ has: page.getByRole("heading", { name: "Contractors" }) })],
    ["assignments", page.locator(".setup-card").filter({ has: page.getByRole("heading", { name: "Assignments" }) })],
  ];
  for (const [label, target] of sections) {
    await bringIntoView(target);
    await assertNoOverflow(page, label, device);
    if (!checkOnly) await target.screenshot({ path: path.join(outputDir, `${label}-${device.name}.png`) });
  }
  await context.close();
}

await browser.close();
if (!checkOnly) {
  console.log(`Captured ${fs.readdirSync(outputDir).filter((name) => name.endsWith(".png")).length} screenshots in ${outputDir}.`);
}
