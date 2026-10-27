import { chromium } from "playwright";

const base = process.env.MENU_E2E_BASE_URL || "http://localhost:3000";

function mondayInAuckland(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-NZ", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const value = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)));
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const value = new Date(`${iso}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dayLabel(weekStart, offset) {
  const iso = addDays(weekStart, offset);
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][offset];
  const pretty = new Intl.DateTimeFormat("en-NZ", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
  return `${weekday} ${pretty}`;
}

const weekStart = mondayInAuckland();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  timezoneId: "Pacific/Auckland",
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);

async function api(pathname, body, method = "POST") {
  return page.evaluate(async ({ pathname, body, method }) => {
    const response = await fetch(pathname, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`${method} ${pathname}:${response.status}:${data.error ?? "request_failed"}`);
    return data;
  }, { pathname, body, method });
}

try {
  const email = `menu.${Date.now()}@example.test`;
  await page.goto(`${base}/sign-up`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const button = document.querySelector("form button");
    return Boolean(button && Object.keys(button).some((key) => key.startsWith("__reactProps")));
  });
  await page.getByLabel("Your name").fill("Demo Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("CleanTrackDemoPass1");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL("**/dashboard");
  await api("/api/business", {
    name: "Demo Cleaning Co", nzbn: "", address: "", contactEmail: email, contactPhone: "",
    timezone: "Pacific/Auckland", currency: "NZD", weekStart: "monday",
  });
  const north = await api("/api/sites", { name: "Demo Site North", address: "" });
  const south = await api("/api/sites", { name: "Demo Site South", address: "" });
  const alex = await api("/api/contractors", { name: "Alex Sample", email: "", phone: "", defaultRateCents: 3200 });
  const sam = await api("/api/contractors", { name: "Sam Placeholder", email: "", phone: "", defaultRateCents: 3000 });
  const alexNorth = await api("/api/assignments", { contractorId: alex.id, siteId: north.id, rateCents: null });
  const samSouth = await api("/api/assignments", { contractorId: sam.id, siteId: south.id, rateCents: null });
  for (const assignmentId of [alexNorth.id, samSouth.id]) {
    await api(`/api/assignments/${assignmentId}/schedule`, {
      weekdays: [1, 2, 3, 4, 5], paidMinutes: 60, weekStart, fromDate: weekStart, mode: "create",
    }, "PUT");
  }
  await api("/api/business/onboarding/complete");
  const dashboard = await api(`/api/dashboard?week=${weekStart}`, undefined, "GET");
  const alexEntries = dashboard.entries.filter((entry) => entry.contractorId === alex.id);
  const byDate = Object.fromEntries(alexEntries.map((entry) => [entry.workDate, entry.id]));
  await api(`/api/time-entries/${byDate[addDays(weekStart, 0)]}/exception`, { kind: "absent", scope: "this_day" });
  await api(`/api/time-entries/${byDate[addDays(weekStart, 1)]}/exception`, { kind: "hours_override", scope: "this_day", paidMinutes: 75 });
  await api(`/api/time-entries/${byDate[addDays(weekStart, 2)]}/exception`, { kind: "confirm_worked", scope: "this_day" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("1h 15m (sched 1h)").first().waitFor();

  const friday = dayLabel(weekStart, 4);
  const triggerName = `Actions for Sam Placeholder at Demo Site South on ${friday}`;
  const trigger = page.getByRole("button", { name: triggerName });
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const didntWork = page.getByRole("menuitem", { name: "Didn't work" });
  await didntWork.waitFor();
  const probe = await page.evaluate(() => {
    const menu = document.querySelector(".day-menu");
    const wrap = document.querySelector(".week-grid-wrap");
    const item = document.querySelector(".day-menu [role='menuitem']");
    const box = item.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return {
      portaled: menu.parentElement === document.body,
      insideWrap: wrap.contains(menu),
      menuBottom: menu.getBoundingClientRect().bottom,
      wrapBottom: wrap.getBoundingClientRect().bottom,
      hitRole: hit?.getAttribute("role") ?? hit?.tagName ?? null,
    };
  });
  if (!probe.portaled || probe.insideWrap) throw new Error(`menu is still clipped by the grid: ${JSON.stringify(probe)}`);
  if (probe.menuBottom <= probe.wrapBottom) throw new Error(`menu did not extend past the grid: ${JSON.stringify(probe)}`);
  if (probe.hitRole !== "menuitem") throw new Error(`elementFromPoint missed the menu: ${JSON.stringify(probe)}`);
  console.log(`desktop menu past wrap ${JSON.stringify(probe)}`);

  await page.waitForFunction(() => document.activeElement?.textContent === "Didn't work");
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(() => document.activeElement?.textContent === "Change hours");
  await page.keyboard.press("Escape");
  await page.waitForFunction((name) => {
    const active = document.activeElement;
    return active?.getAttribute("aria-label") === name && active.getAttribute("aria-expanded") === "false";
  }, triggerName);
  await trigger.click();
  await didntWork.click();
  await page.getByRole("group", { name: `Didn't work, 1h scheduled, Sam Placeholder at Demo Site South, ${friday}` }).waitFor();
  console.log("clicked Didn't work on the last desktop row");

  await trigger.click();
  await didntWork.waitFor();
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/08-desktop-menu-open.png" });

  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 375, height: 1100 });
  await page.locator(".week-grid-mobile article").first().evaluate((element) => element.scrollIntoView({ block: "start" }));
  const mobileTrigger = page.getByRole("button", { name: `Actions for Alex Sample at Demo Site North on ${friday}` });
  await mobileTrigger.click();
  const mobileItem = page.getByRole("menuitem", { name: "Didn't work" });
  await mobileItem.waitFor();
  const mobileHit = await page.evaluate(() => {
    const item = [...document.querySelectorAll(".day-menu [role='menuitem']")].find((node) => node.textContent === "Didn't work");
    const box = item.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit?.getAttribute("role") ?? hit?.tagName ?? null;
  });
  if (mobileHit !== "menuitem") throw new Error(`mobile elementFromPoint missed the menu: ${mobileHit}`);
  const mobileLayout = await page.evaluate(() => {
    const menu = document.querySelector(".day-menu")?.getBoundingClientRect();
    const changed = [...document.querySelectorAll(".week-grid-mobile .day-status")].map((node) => node.textContent);
    return { menuTop: menu?.top ?? null, menuBottom: menu?.bottom ?? null, statuses: changed };
  });
  console.log(`mobile layout ${JSON.stringify(mobileLayout)}`);
  await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/09-mobile-menu-open.png" });
  console.log("menu opens on a 375px viewport");
} finally {
  await browser.close();
}
