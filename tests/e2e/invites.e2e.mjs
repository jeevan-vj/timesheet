import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const appBaseUrl = "http://localhost:3000";
const mailpitUrl = "http://127.0.0.1:8025";
const evidence = path.resolve("docs/verification/invites");
const nonce = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const ownerEmail = `owner.invites+${nonce}@example.test`;
const contractorEmail = `sam.contractor+${nonce}@example.test`;
const ownerPassword = "Synthetic-owner-password-46";
const contractorPassword = "Synthetic-contractor-password-46";

async function shot(page, name) {
  await page.screenshot({ path: path.join(evidence, name), fullPage: true });
}

async function waitForInviteMessage() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailpitUrl}/api/v1/messages`);
    const body = await response.json();
    const message = body.messages?.find((item) => item.To?.some((to) => to.Address?.toLowerCase() === contractorEmail));
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Synthetic invitation did not arrive in Mailpit");
}

function inviteUrlFromMessage(message) {
  const source = `${message.HTML ?? ""}\n${message.Text ?? ""}`.replaceAll("&amp;", "&");
  const match = source.match(/https?:\/\/[^\s"'<]+\/invite\/[A-Za-z0-9_-]{43}/);
  if (!match) throw new Error("Invitation link was not present in the synthetic Mailpit message");
  return match[0];
}

await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });
const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const owner = await ownerContext.newPage();
const contractorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const contractor = await contractorContext.newPage();
owner.setDefaultTimeout(120_000);
contractor.setDefaultTimeout(120_000);

try {
  await owner.goto(`${appBaseUrl}/sign-up`);
  await owner.waitForLoadState("networkidle");
  await owner.waitForTimeout(750);
  await owner.getByLabel("Your name").fill("Synthetic Owner");
  await owner.getByLabel("Email").fill(ownerEmail);
  await owner.getByLabel("Password").fill(ownerPassword);
  await owner.getByRole("button", { name: "Create account" }).click();
  try {
    await owner.getByRole("heading", { name: "Hours & contractor pay" }).waitFor();
  } catch (error) {
    await owner.screenshot({ path: "/private/tmp/cleantrack-invites-signup-failure.png", fullPage: true });
    throw error;
  }
  await owner.getByText("No shifts this week").waitFor();
  await owner.getByLabel("Business name").fill("Synthetic Cleaning 46");
  await owner.getByLabel("Contact email").fill(ownerEmail);
  await owner.getByRole("button", { name: "Save business" }).click();
  await owner.getByText("Business saved.", { exact: true }).waitFor();
  await owner.getByRole("heading", { name: "Contractors", exact: true }).waitFor();
  await owner.locator("#team").scrollIntoViewIfNeeded();
  await owner.getByRole("button", { name: "Add contractor" }).click();
  await owner.getByLabel("Name", { exact: true }).fill("Sam Synthetic");
  await owner.getByRole("dialog").getByLabel(/^Email/).fill(contractorEmail);
  await owner.getByLabel("Default hourly rate (NZD)").fill("32.00");
  await owner.getByRole("button", { name: "Save contractor" }).click();
  await owner.getByRole("button", { name: "Invite Sam Synthetic" }).waitFor();
  await shot(owner, "01-owner-contractors-invite.png");
  await owner.getByRole("button", { name: "Invite Sam Synthetic" }).click();
  await owner.getByText("Pending", { exact: true }).waitFor();
  await shot(owner, "02-owner-pending.png");

  const summary = await waitForInviteMessage();
  const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${summary.ID}`);
  if (!detailResponse.ok) throw new Error("Could not read the synthetic Mailpit message");
  const detail = await detailResponse.json();
  const inviteUrl = inviteUrlFromMessage(detail);

  const mailpit = await ownerContext.newPage();
  await mailpit.goto(mailpitUrl);
  const messageRow = mailpit.getByRole("link").filter({ hasText: contractorEmail });
  await messageRow.waitFor();
  await shot(mailpit, "03-mailpit-inbox.png");
  await messageRow.click();
  await mailpit.waitForTimeout(500);
  await shot(mailpit, "04-mailpit-message.png");
  await mailpit.close();

  const invitePageResponse = await contractor.goto(inviteUrl);
  if (invitePageResponse?.headers()["cache-control"] !== "no-store") throw new Error("Invitation page was not served with Cache-Control: no-store");
  await contractor.waitForTimeout(1_500);
  await contractor.getByRole("heading", { name: "Create your contractor account" }).waitFor();
  await shot(contractor, "05-invite-page.png");
  await contractor.getByLabel("Your name").fill("Sam Synthetic");
  await contractor.getByLabel("Password").fill(contractorPassword);
  await shot(contractor, "06-contractor-signup.png");
  await contractor.getByRole("button", { name: "Create account and accept" }).click();
  await contractor.getByRole("heading", { name: "Invitation accepted" }).waitFor();
  await shot(contractor, "07-invite-accepted.png");

  await owner.reload();
  await owner.getByText("Accepted", { exact: true }).waitFor();
  await shot(owner, "08-owner-accepted.png");

  await contractor.getByRole("link", { name: "Continue to contractor account" }).click();
  await contractor.getByRole("heading", { name: "Welcome to CleanTrack" }).waitFor();
  await contractor.waitForTimeout(1_500);
  await contractor.getByRole("button", { name: "Sign out" }).click();
  await contractor.waitForURL(`${appBaseUrl}/`);
  await contractor.goto(`${appBaseUrl}/sign-in`);
  await contractor.waitForTimeout(1_500);
  await contractor.getByLabel("Email").fill(contractorEmail);
  await contractor.getByLabel("Password").fill(contractorPassword);
  await contractor.getByRole("button", { name: "Sign in" }).click();
  await contractor.getByRole("heading", { name: "Welcome to CleanTrack" }).waitFor();
  await shot(contractor, "09-contractor-landing.png");

  const negative = await contractorContext.newPage();
  await negative.goto(inviteUrl);
  await negative.getByRole("heading", { name: "This invitation can’t be used" }).waitFor();
  await shot(negative, "10-negative-state.png");
  await negative.close();
} finally {
  await ownerContext.close();
  await contractorContext.close();
  await browser.close();
}
