import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const mailpitUrl = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const outDir = process.env.E2E_ARTIFACTS ?? "/opt/cursor/artifacts/invite-accept";
const stamp = Date.now().toString(36);
const ownerEmail = `owner.invite.${stamp}@example.test`;
const cleanerEmail = `cleaner.invite.${stamp}@example.test`;
const ownerPassword = "owner-pass-123456";
const cleanerPassword = "cleaner-pass-123456";

async function shot(page, name) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), fullPage: true });
}

async function inviteLinkFromInbox() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = await readInboxLink();
    if (found) return found;
    await delay(500);
  }
  throw new Error("invitation email was not captured");
}

function messageRecipients(message) {
  const recipients = message.To ?? message.to ?? [];
  return recipients.map((item) => String(item.Address ?? item.address ?? "").toLowerCase());
}

async function readInboxLink() {
  const list = await (await fetch(`${mailpitUrl}/api/v1/messages`)).json();
  const messages = Array.isArray(list.messages) ? list.messages : [];
  for (const message of messages) {
    if (!messageRecipients(message).includes(cleanerEmail)) continue;
    const full = await (await fetch(`${mailpitUrl}/api/v1/message/${message.ID}`)).json();
    const match = `${full.Text ?? ""}\n${full.HTML ?? ""}`.match(/https?:\/\/[^"'\\\s]+\/invite#[A-Za-z0-9_-]{20,200}/);
    if (match) return match[0].replaceAll("&amp;", "&");
  }
  return "";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function signUpOwner(page) {
  await page.goto(`${baseUrl}/sign-up`, { waitUntil: "networkidle" });
  await page.getByLabel("Your name").fill("Owner Invite");
  await page.getByLabel("Email").fill(ownerEmail);
  await page.getByLabel("Password").fill(ownerPassword);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Add your business" }).waitFor();
  await shot(page, "01-owner-signed-up");
}

async function saveBusiness(page) {
  await page.getByLabel("Business name").fill("Northwind Cleaning");
  await page.getByLabel("Contact email").fill("office.invite@example.test");
  await page.getByRole("button", { name: "Save business" }).click();
  await page.getByRole("heading", { name: "Add a cleaning site" }).waitFor();
  await shot(page, "02-business-saved");
}

async function addContractor(page) {
  await page.getByRole("button", { name: "Add contractor" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Aroha North");
  await dialog.getByRole("textbox", { name: /^Email\b/ }).fill(cleanerEmail);
  await dialog.getByLabel("Default hourly rate (NZD)").fill("32");
  await dialog.getByRole("button", { name: "Save contractor" }).click();
  await page.getByRole("button", { name: "Invite Aroha North" }).waitFor();
  await shot(page, "03-contractor-added");
}

async function sendInvite(page) {
  await page.getByRole("button", { name: "Invite Aroha North" }).click();
  await page.getByRole("button", { name: "Send invitation" }).click();
  await page.getByText("Invitation pending").waitFor();
  await shot(page, "04-invitation-sent");
}

async function acceptInvite(page, link) {
  await page.goto(link, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Set up your CleanTrack account" }).waitFor();
  await shot(page, "05-set-password");
  const passwords = page.getByLabel("Password");
  await passwords.first().fill(cleanerPassword);
  await page.getByLabel("Confirm password").fill(cleanerPassword);
  await page.getByRole("button", { name: "Create account and continue" }).click();
  await page.getByRole("heading", { name: "My work" }).waitFor();
  await page.getByText("My work at Northwind Cleaning").waitFor();
  await shot(page, "06-portal-signed-in");
}

async function signInAgain(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/$/);
  await shot(page, "07-signed-out");
  await page.goto(`${baseUrl}/sign-in`, { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(cleanerEmail);
  await page.getByLabel("Password").fill(cleanerPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "My work" }).waitFor();
  await page.getByText("My work at Northwind Cleaning").waitFor();
  await shot(page, "08-portal-signed-in-again");
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: process.env.E2E_HEADLESS !== "0" });
  const ownerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: path.join(outDir, "video") } });
  const owner = await ownerContext.newPage();
  await signUpOwner(owner);
  await saveBusiness(owner);
  await addContractor(owner);
  await sendInvite(owner);
  const link = await inviteLinkFromInbox();
  const contractorContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: path.join(outDir, "video") } });
  const contractor = await contractorContext.newPage();
  await acceptInvite(contractor, link);
  await owner.reload();
  await owner.getByText("Active (portal)").waitFor();
  await shot(owner, "09-owner-active-portal");
  await signInAgain(contractor);
  await contractorContext.close();
  await ownerContext.close();
  await browser.close();
  process.stdout.write(`invite-accept-e2e ok ${outDir}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "invite-accept-e2e failed";
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
