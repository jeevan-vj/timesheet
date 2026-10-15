import fs from "node:fs";
import path from "node:path";
import { addDaysIso, amountNeedle, minutesLabel, syntheticRoster } from "./payroll-fixture.mjs";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INVITE_ISSUE = "https://github.com/jeevan-vj/timesheet/issues/46";
const PORTAL_ISSUE = "https://github.com/jeevan-vj/timesheet/issues/47";

function runId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function shot(page, directory, id) {
  const relative = `screenshots/${id}.png`;
  await page.screenshot({ path: path.join(directory, `${id}.png`), fullPage: true });
  return relative;
}

async function expectNotice(page, text) {
  await page.locator("main > p.notice").filter({ hasText: text }).waitFor({ timeout: 20_000 });
}

async function signUp(page, baseUrl, person) {
  await page.goto(new URL("/sign-up", baseUrl).toString(), { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Create your owner account" }).waitFor();
  await page.getByLabel("Your name").fill(person.name);
  await page.getByLabel("Email").fill(person.email);
  await page.getByLabel("Password").fill(person.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/dashboard(?:\/|$|\?)/, { timeout: 30_000 });
  await page.getByRole("heading", { name: "Hours & contractor pay" }).waitFor();
}

async function saveBusiness(page, business) {
  await page.getByRole("heading", { name: "Add your business" }).waitFor();
  await page.getByLabel("Business name").fill(business.name);
  await page.getByLabel("Contact email").fill(business.email);
  await page.getByLabel("NZBN").fill("");
  await page.getByRole("button", { name: "Save business" }).click();
  await expectNotice(page, "Business saved.");
  await page.getByRole("heading", { name: "Add a cleaning site" }).waitFor();
}

async function openDetails(details) {
  if (!(await details.evaluate((node) => node.open))) await details.locator("summary").click();
}

async function addSite(page, site) {
  const card = page.locator(".site-setup");
  await openDetails(card.locator("details"));
  await card.getByLabel("Site name").fill(site.name);
  await card.getByLabel("Site address").fill(site.address);
  await card.getByRole("button", { name: "Save site" }).click();
  await expectNotice(page, "Site added.");
  await card.getByText(site.name, { exact: true }).waitFor();
}

async function addContractor(page, contractor) {
  const opener = page.getByRole("button", { name: "Add contractor" }).or(page.getByRole("button", { name: "+ Add contractor" }));
  await opener.first().click();
  const dialog = page.getByRole("dialog", { name: "Add contractor" });
  await dialog.getByLabel("Name", { exact: true }).fill(contractor.name);
  await dialog.getByLabel("Email").fill(contractor.email);
  await dialog.getByLabel("Phone").fill(contractor.phone);
  await dialog.getByLabel("Default hourly rate (NZD)").fill(contractor.rateDollars);
  await dialog.getByRole("button", { name: "Save contractor" }).click();
  await expectNotice(page, "Contractor added.");
  await page.locator(".contractor-row").filter({ hasText: contractor.name }).waitFor();
}

async function assign(page, contractor, site, overrideDollars) {
  await page.waitForFunction((name) => {
    const select = document.querySelector("select[name='contractorId']");
    return Boolean(select && [...select.options].some((option) => option.textContent === name));
  }, contractor);
  const details = page.locator("details").filter({ has: page.locator("summary", { hasText: "+ Assign to site" }) });
  await openDetails(details);
  const form = details.locator("form");
  await form.locator("select[name='contractorId']").selectOption({ label: contractor });
  await form.locator("select[name='siteId']").selectOption({ label: site });
  if (overrideDollars) await form.locator("input[name='rate']").fill(overrideDollars);
  await form.getByRole("button", { name: "Save assignment" }).click();
  await expectNotice(page, "Assignment added.");
}

async function setChecked(checkbox, want) {
  if ((await checkbox.isChecked()) !== want) await checkbox.click();
}

async function addSchedule(page, contractor, site, schedule) {
  const open = page.getByRole("button", { name: "Add repeating schedule" });
  await open.waitFor();
  await page.waitForFunction((button) => !button.disabled, await open.elementHandle());
  await open.click();
  const picker = page.getByRole("dialog", { name: "Add repeating schedule" });
  const label = `${contractor} — ${site}`;
  await picker.getByLabel("Assignment").selectOption({ label });
  await picker.getByRole("button", { name: "Continue" }).click();
  const editor = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Save schedule" }) });
  for (const day of WEEKDAYS) {
    await setChecked(editor.getByRole("checkbox", { name: day, exact: true }), schedule.weekdays.includes(day));
  }
  await editor.getByLabel("Hours", { exact: true }).fill(String(schedule.hours));
  await editor.getByLabel("Minutes", { exact: true }).fill(String(schedule.minutes));
  await editor.getByRole("button", { name: "Save schedule" }).click();
  await expectNotice(page, "Repeating schedule added.");
}

async function addPaidShift(page, contractor, site, workDate, hours, minutes) {
  await page.getByRole("button", { name: "+ Add shift" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a completed shift" });
  await dialog.getByLabel("Contractor").selectOption({ label: contractor });
  await dialog.getByLabel("Site").selectOption({ label: site });
  await dialog.getByLabel("Date").fill(workDate);
  await dialog.getByRole("radio", { name: "Paid hours" }).check();
  await dialog.getByLabel("Hours", { exact: true }).fill(String(hours));
  await dialog.getByLabel("Minutes", { exact: true }).fill(String(minutes));
  await dialog.getByRole("button", { name: "Save shift" }).click();
  await expectNotice(page, "Shift added.");
}

async function addClockShift(page, contractor, site, workDate, shift) {
  await page.getByRole("button", { name: "+ Add shift" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a completed shift" });
  await dialog.getByLabel("Contractor").selectOption({ label: contractor });
  await dialog.getByLabel("Site").selectOption({ label: site });
  await dialog.getByLabel("Date").fill(workDate);
  await dialog.getByRole("radio", { name: "Start & finish" }).check();
  await dialog.getByLabel("Start", { exact: true }).fill(shift.start);
  await dialog.getByLabel("Finish", { exact: true }).fill(shift.end);
  await dialog.getByLabel("Unpaid break").selectOption({ label: "No break" });
  await dialog.getByRole("button", { name: "Save shift" }).click();
  await expectNotice(page, "Shift added.");
}

async function dashboard(page, baseUrl, week) {
  const response = await page.request.get(new URL(`/api/dashboard?week=${week}`, baseUrl).toString());
  const body = await response.json().catch(() => ({}));
  if (!response.ok()) throw new Error(`Dashboard read failed (${response.status()}).`);
  return body;
}

async function moneyLabel(page, cents) {
  return page.evaluate(
    (value) => new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(value / 100),
    cents,
  );
}

async function expectNotFound(page, baseUrl, resourcePath) {
  const response = await page.request.get(new URL(resourcePath, baseUrl).toString());
  const body = await response.json().catch(() => ({}));
  if (response.status() !== 404 || body.error !== "not_found") {
    throw new Error(`${resourcePath} returned ${response.status()} ${body.error ?? "no error code"}.`);
  }
}

function sameSummary(actual, expected) {
  return actual.length === expected.length && expected.every((row) => {
    const match = actual.find((item) => item.contractorName === row.name);
    return match && match.paidMinutes === row.paidMinutes && match.payCents === row.payCents;
  });
}

export async function runOwnerFlow({ page, baseUrl, screenshotDir }) {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const roster = syntheticRoster(runId());
  const results = [];
  let blocked = false;
  let week = "";
  let ownerData = null;
  let ownerInviteButtons = 0;

  async function step(id, fn) {
    if (blocked) {
      results.push({ id, status: "blocked", detail: "An earlier step failed.", screenshots: [] });
      return;
    }
    try {
      const outcome = await fn();
      results.push({
        id,
        status: outcome.status ?? "pass",
        detail: outcome.detail ?? "",
        screenshots: outcome.screenshots ?? [],
        issues: outcome.issues ?? [],
      });
      if (outcome.status === "fail") blocked = true;
    } catch (error) {
      const screenshots = [];
      try {
        screenshots.push(await shot(page, screenshotDir, `${id}-failure`));
      } catch {
        // The page may already be closed. The step detail still records the error.
      }
      results.push({
        id,
        status: "fail",
        detail: error instanceof Error ? error.message : "Step failed.",
        screenshots: screenshots.filter(Boolean),
        issues: [],
      });
      blocked = true;
    }
  }

  await step("register-onboarding", async () => {
    const screenshots = [];
    await signUp(page, baseUrl, { ...roster.owner, password: roster.password });
    week = await page.getByLabel("Week of").inputValue();
    if (new Date(`${week}T00:00:00.000Z`).getUTCDay() !== 1) throw new Error(`Week control is not a Monday (${week}).`);
    screenshots.push(await shot(page, screenshotDir, "01-business-onboarding"));
    await saveBusiness(page, { name: roster.owner.business, email: roster.owner.email });
    screenshots.push(await shot(page, screenshotDir, "01-site-step"));
    await addSite(page, roster.sites[0]);
    await page.getByRole("heading", { name: "Add a contractor" }).waitFor();
    await addContractor(page, roster.contractors[0]);
    await page.getByRole("heading", { name: "Assign a contractor to a site" }).waitFor();
    await assign(page, roster.contractors[0].name, roster.contractors[0].site, "");
    await page.getByRole("heading", { name: "Add a repeating schedule, or finish" }).waitFor();
    await addSchedule(page, roster.contractors[0].name, roster.contractors[0].site, roster.contractors[0].schedule);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expectNotice(page, "Setup finished.");
    await page.locator("[data-feature='owner-onboarding']").waitFor({ state: "detached" });
    screenshots.push(await shot(page, screenshotDir, "01-onboarding-finished"));
    return { screenshots, detail: `Synthetic owner onboarded for week ${week}.` };
  });

  await step("sites-contractors", async () => {
    for (const site of roster.sites.slice(1)) await addSite(page, site);
    for (const contractor of roster.contractors.slice(1)) await addContractor(page, contractor);
    const body = await dashboard(page, baseUrl, week);
    const siteNames = body.sites.map((site) => site.name).sort();
    const contractorRates = [...body.contractors].map((contractor) => [contractor.name, contractor.defaultRateCents]).sort((a, b) => a[0].localeCompare(b[0]));
    const expectedRates = roster.contractors.map((contractor) => [contractor.name, contractor.defaultRateCents]).sort((a, b) => a[0].localeCompare(b[0]));
    if (siteNames.join("|") !== roster.sites.map((site) => site.name).sort().join("|")) {
      throw new Error("Site list does not match the three synthetic sites.");
    }
    if (JSON.stringify(contractorRates) !== JSON.stringify(expectedRates)) {
      throw new Error("Contractor default rates do not match the fixture.");
    }
    await page.locator("#team").scrollIntoViewIfNeeded();
    return {
      screenshots: [await shot(page, screenshotDir, "02-sites-contractors")],
      detail: "3 sites and 4 contractors stored with distinct default rates.",
    };
  });

  await step("assignments-schedules", async () => {
    for (const contractor of roster.contractors.slice(1)) {
      await assign(page, contractor.name, contractor.site, contractor.overrideDollars);
    }
    const ben = roster.contractors[1];
    await addSchedule(page, ben.name, ben.site, ben.schedule);
    const body = await dashboard(page, baseUrl, week);
    if (body.assignments.length < 4) throw new Error(`Expected 4 assignments, saw ${body.assignments.length}.`);
    const scheduled = body.assignments.filter((assignment) => assignment.schedule);
    if (scheduled.length < 2) throw new Error(`Expected 2 repeating schedules, saw ${scheduled.length}.`);
    const applied = roster.contractors.filter((contractor) => contractor.schedule);
    for (const contractor of applied) {
      const rows = body.entries.filter((entry) => entry.contractorName === contractor.name);
      if (rows.length !== contractor.occurrences) {
        throw new Error(`${contractor.name} has ${rows.length} scheduled entries, expected ${contractor.occurrences}.`);
      }
      if (rows.some((entry) => entry.rateCents !== contractor.snapshotRateCents || entry.paidMinutes !== contractor.paidMinutesEach)) {
        throw new Error(`${contractor.name} scheduled entries do not match the snapshotted rate or minutes.`);
      }
    }
    return {
      screenshots: [await shot(page, screenshotDir, "03-assignments-schedules")],
      detail: "4 assignments. Aroha and Ben schedules materialized scheduled entries at snapshotted rates.",
    };
  });

  await step("week-totals-approval", async () => {
    const screenshots = [];
    for (const contractor of roster.contractors.filter((item) => item.shift)) {
      const workDate = addDaysIso(week, contractor.shift.dayOffset);
      if (contractor.shift.mode === "paid_hours") {
        await addPaidShift(page, contractor.name, contractor.site, workDate, contractor.shift.hours, contractor.shift.minutes);
      } else {
        await addClockShift(page, contractor.name, contractor.site, workDate, contractor.shift);
      }
    }
    ownerData = await dashboard(page, baseUrl, week);
    if (!sameSummary(ownerData.summary, roster.contractors)) {
      throw new Error(`Week summary was ${JSON.stringify(ownerData.summary.map((row) => ({ name: row.contractorName, paidMinutes: row.paidMinutes, payCents: row.payCents })))}.`);
    }
    if (ownerData.entries.length !== roster.totals.entries) {
      throw new Error(`Expected ${roster.totals.entries} entries, saw ${ownerData.entries.length}.`);
    }
    const uiMinutes = await page.locator(".stats article").filter({ hasText: "Paid hours" }).locator("strong").innerText();
    const uiPay = await page.locator(".stats article").filter({ hasText: "Contractor pay" }).locator("strong").innerText();
    const expectedPay = await moneyLabel(page, roster.totals.payCents);
    if (uiMinutes.trim() !== minutesLabel(roster.totals.paidMinutes)) {
      throw new Error(`Paid hours showed ${uiMinutes.trim()}.`);
    }
    if (uiPay.trim() !== expectedPay) throw new Error(`Contractor pay showed ${uiPay.trim()}, expected ${expectedPay}.`);
    const sitePanel = page.locator("[data-feature='week-site-summary']");
    for (const site of roster.siteTotals) {
      const row = sitePanel.locator(".summary-row").filter({ hasText: site.name });
      if ((await row.locator("b").innerText()).trim() !== await moneyLabel(page, site.payCents)) {
        throw new Error(`Site total for ${site.name} did not match ${site.payCents} cents.`);
      }
    }
    screenshots.push(await shot(page, screenshotDir, "04-week-totals"));
    await page.getByRole("button", { name: "Approve week" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve this week?" });
    const description = await dialog.locator("#week-approval-copy").innerText();
    if (!description.includes(expectedPay) || !description.includes(minutesLabel(roster.totals.paidMinutes))) {
      throw new Error("Approval confirmation did not show the week totals.");
    }
    await dialog.getByRole("button", { name: "Approve week" }).click();
    await expectNotice(page, "Week approved.");
    await page.getByLabel("Week status: Approved & locked").waitFor();
    const locked = await dashboard(page, baseUrl, week);
    if (locked.approval.status !== "approved") throw new Error("Week approval status was not approved.");
    const sample = locked.entries[0];
    const refused = await page.request.post(new URL("/api/time-entries", baseUrl).toString(), {
      headers: { Origin: baseUrl },
      data: {
        entryMode: "paid_hours",
        contractorId: sample.contractorId,
        siteId: sample.siteId,
        workDate: addDaysIso(week, 5),
        paidMinutes: 60,
        notes: "",
      },
    });
    const refusedBody = await refused.json().catch(() => ({}));
    if (refused.status() !== 409 || refusedBody.error !== "week_locked") {
      throw new Error(`Locked week accepted a new shift (${refused.status()}).`);
    }
    await page.getByText("This week is approved and locked. Reopen it to add a shift.").waitFor();
    screenshots.push(await shot(page, screenshotDir, "04-week-approved"));
    return {
      screenshots,
      detail: `${roster.totals.entries} entries, ${roster.totals.paidMinutes} minutes, ${roster.totals.payCents} cents. Site cents match the contractor total. Week locked.`,
    };
  });

  await step("remittance", async () => {
    const screenshots = [];
    let opened = false;
    for (const contractor of roster.contractors) {
      const match = ownerData.summary.find((row) => row.contractorName === contractor.name);
      const record = ownerData.contractors.find((row) => row.name === contractor.name);
      if (!match || !record) throw new Error(`Missing remittance source for ${contractor.name}.`);
      if (!opened) {
        await page.getByRole("button", { name: `Download remittance for ${contractor.name}` }).click();
        await page.getByRole("dialog", { name: "Download remittance?" }).waitFor();
        screenshots.push(await shot(page, screenshotDir, "05-remittance-dialog"));
        await page.getByRole("button", { name: "Close remittance confirmation" }).click();
        opened = true;
      }
      const response = await page.request.get(new URL(`/api/contractors/${record.id}/remittance?week=${week}`, baseUrl).toString());
      const bytes = Buffer.from(await response.body());
      const pdfType = response.headers()["content-type"] ?? "";
      if (response.status() !== 200 || !pdfType.includes("application/pdf") || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new Error(`Remittance for ${contractor.name} was not a PDF (${response.status()}).`);
      }
      const { pdfText } = await import("./pdf-text.mjs");
      const text = pdfText(bytes);
      if (!text.includes(contractor.name) || !text.includes(contractor.site) || !text.includes("Remittance Advice")) {
        throw new Error(`Remittance PDF for ${contractor.name} is missing the contractor, site, or title.`);
      }
      if (!text.includes(amountNeedle(match.payCents)) || !text.includes(amountNeedle(contractor.snapshotRateCents))) {
        throw new Error(`Remittance PDF for ${contractor.name} does not include the gross pay or snapshotted rate.`);
      }
      if (contractor.overrideDollars && text.includes(amountNeedle(contractor.defaultRateCents))) {
        throw new Error(`${contractor.name} remittance used the default rate instead of the site override.`);
      }
    }
    await page.getByRole("button", { name: `Download remittance for ${roster.contractors[0].name}` }).click();
    const download = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
    await page.getByRole("dialog", { name: "Download remittance?" }).getByRole("button", { name: "Download remittance" }).click();
    await expectNotice(page, "Remittance downloaded.");
    const saved = await download;
    screenshots.push(await shot(page, screenshotDir, "05-remittance-downloaded"));
    const downloadNote = saved ? "The browser saved the PDF." : "The browser did not emit a download event; the screen reported Remittance downloaded and the PDF bytes were checked separately.";
    return { screenshots, detail: `Each contractor PDF contains the snapshotted gross amount. ${downloadNote} The week stayed locked.` };
  });

  await step("cross-business-isolation", async () => {
    if (!ownerData) throw new Error("Owner data was not captured.");
    await page.locator("#team").scrollIntoViewIfNeeded();
    ownerInviteButtons = await page.getByRole("button", { name: /invite/i }).count();
    const ownerIds = {
      sites: ownerData.sites.map((site) => site.id),
      contractors: ownerData.contractors.map((contractor) => contractor.id),
      assignments: ownerData.assignments.map((assignment) => assignment.id),
      entries: ownerData.entries.map((entry) => entry.id),
    };
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await signUp(page, baseUrl, { ...roster.otherOwner, password: roster.password });
    await saveBusiness(page, { name: roster.otherOwner.business, email: roster.otherOwner.email });
    const visible = await page.locator("main").innerText();
    for (const name of [...roster.sites.map((site) => site.name), ...roster.contractors.map((contractor) => contractor.name), roster.owner.business]) {
      if (visible.includes(name)) throw new Error(`Second owner dashboard shows ${name}.`);
    }
    for (const id of ownerIds.sites) await expectNotFound(page, baseUrl, `/api/sites/${id}`);
    for (const id of ownerIds.contractors) {
      await expectNotFound(page, baseUrl, `/api/contractors/${id}`);
      await expectNotFound(page, baseUrl, `/api/contractors/${id}/remittance?week=${week}`);
    }
    for (const id of ownerIds.assignments) await expectNotFound(page, baseUrl, `/api/assignments/${id}`);
    for (const id of ownerIds.entries) await expectNotFound(page, baseUrl, `/api/time-entries/${id}`);
    const siteList = await (await page.request.get(new URL("/api/sites?includeArchived=1", baseUrl).toString())).json();
    const contractorList = await (await page.request.get(new URL("/api/contractors?includeArchived=1", baseUrl).toString())).json();
    const leakedSite = Array.isArray(siteList) && siteList.some((site) => ownerIds.sites.includes(site.id));
    const leakedContractor = Array.isArray(contractorList?.contractors) && contractorList.contractors.some((contractor) => ownerIds.contractors.includes(contractor.id));
    if (leakedSite || leakedContractor) throw new Error("Second owner list includes the first owner's rows.");
    return {
      screenshots: [await shot(page, screenshotDir, "06-second-owner")],
      detail: "Second owner lists are empty of the first business. Direct site, contractor, assignment, entry, and remittance reads return 404 not_found.",
    };
  });

  await step("contractor-invite-and-portal", async () => {
    const screenshots = [];
    const probes = ["/invite", "/contractor", "/contractors/portal", "/api/invitations"];
    if (ownerData?.contractors[0]) {
      probes.push(`/api/contractors/${ownerData.contractors[0].id}/invite`);
      probes.push(`/api/contractors/${ownerData.contractors[0].id}/invitations`);
    }
    const inviteButtons = ownerInviteButtons + await page.getByRole("button", { name: /invite/i }).count();
    const portalHeading = await page.getByRole("heading", { name: "My week" }).count();
    const probeResults = [];
    for (const probe of probes) {
      const response = await page.request.get(new URL(probe, baseUrl).toString());
      probeResults.push(`${probe} ${response.status()}`);
    }
    await page.goto(new URL("/contractor", baseUrl).toString(), { waitUntil: "domcontentloaded" });
    const contractorPage = await page.locator("body").innerText();
    const portalVisible = contractorPage.includes("My week") || contractorPage.includes("My sites");
    screenshots.push(await shot(page, screenshotDir, "07-contractor-route"));
    if (inviteButtons > 0 || portalHeading > 0 || portalVisible) {
      return {
        status: "fail",
        screenshots,
        detail: "Invite or contractor portal UI is present. Enable the skill steps for issues #46 and #47 instead of recording not implemented.",
        issues: [INVITE_ISSUE, PORTAL_ISSUE],
      };
    }
    return {
      status: "not_implemented",
      screenshots,
      issues: [INVITE_ISSUE, PORTAL_ISSUE],
      detail: `No invite control and no contractor portal. Probes: ${probeResults.join(", ")}. Issue #46 (invite and contractor sign-in) and issue #47 (own work and remittance) are still open.`,
    };
  });

  return { roster, week, results };
}
