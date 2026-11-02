import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";

const root = process.cwd();
const mobile = path.join(root, "apps/mobile/src");
const output = path.join(root, "docs/verification/owner-assistant");
await fs.mkdir(output, { recursive: true });

const remittance = {
  kind: "remittance", message: "I checked Aroha's approved week against CleanTrack records.",
  verification: { status: "verified", detail: "Approved week; all scheduled shifts are resolved." },
  remittance: {
    reference: "RA-aroha-2026-10-26", filename: "remittance-aroha-2026-11-01.pdf",
    contractorId: "aroha", contractorName: "Aroha Demo", weekStart: "2026-10-26", weekEnd: "2026-11-01",
    remitterName: "Demo Cleaning", remitterEmail: "owner@example.test", currency: "NZD",
    lines: [
      { workDate: "2026-10-27", siteName: "Whitford", paidMinutes: 120, rateCents: 3250, payCents: 6500 },
      { workDate: "2026-10-29", siteName: "Albany Offices", paidMinutes: 90, rateCents: 3250, payCents: 4875 },
    ], paidMinutes: 210, payCents: 11375,
    disclaimer: "Gross contractor payments before tax, GST, expenses, or adjustments.",
  },
};
const preview = {
  kind: "preview", message: "I found the site and prepared the assignment. Check it before saving.",
  confirmation: {
    action: "assign_site", token: "synthetic-signed-token", expiresAt: "2026-11-02T12:05:00.000Z",
    title: "Assign Aroha Demo to Whitford",
    details: [{ label: "Contractor", value: "Aroha Demo" }, { label: "Site", value: "Whitford" }, { label: "Rate", value: "Default rate (NZ$32.50/hour)" }],
  },
};
const emptyRemittance = {
  kind: "message",
  message: "Akila has no recorded shifts for 26 Oct – 1 Nov, so CleanTrack cannot calculate a remittance yet. Open Week and record the completed shifts. If you use a repeating schedule, apply it for that week first and confirm each shift is correct. Then ask me to check the remittance again.",
};
const assignmentInput = {
  kind: "input",
  message: "Choose the contractor and site, then review the assignment before saving.",
  input: {
    operation: "assign_site",
    contractors: [{ label: "Aroha Demo", value: "Aroha Demo" }, { label: "Akila", value: "Akila" }],
    sites: [{ label: "Whitford", value: "Whitford" }, { label: "Albany Offices", value: "Albany Offices" }],
  },
};
const remittanceInput = {
  kind: "input",
  message: "Choose the contractor and week you want me to verify.",
  input: {
    operation: "get_remittance",
    contractors: [{ label: "Aroha Demo", value: "Aroha Demo" }, { label: "Akila", value: "Akila" }],
    weekStart: "2026-10-26",
  },
};

const virtual = {
  "test-entry": `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { OwnerAssistant } from '${root}/src/components/owner-assistant.tsx';
    import { OwnerAssistantChat } from '${mobile}/components/owner-assistant-chat.tsx';
    import '${root}/src/app/styles.css';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mobile = location.pathname.includes('mobile');
    createRoot(document.getElementById('root')).render(mobile
      ? <QueryClientProvider client={client}><div style={{maxWidth:390,margin:'0 auto',padding:16}}><OwnerAssistantChat /></div></QueryClientProvider>
      : <main className="app-shell"><OwnerAssistant onChanged={() => { window.__changed = true; }} /></main>);
  `,
  "test-mobile-client": `
    window.__histories = [];
    window.__forms = [];
    export async function sendOwnerAssistantTurn(message, history, form) {
      window.__histories.push(history); window.__forms.push(form);
      if (form?.operation === 'get_remittance') return ${JSON.stringify(remittance)};
      if (message.includes('Help me check')) return ${JSON.stringify(remittanceInput)};
      return message.includes('Akila') ? ${JSON.stringify(emptyRemittance)} : message.includes('remittance') ? ${JSON.stringify(remittance)} : ${JSON.stringify(preview)};
    }
    export async function confirmOwnerAssistantChange(token) {
      window.__confirmed = token;
      return { kind: 'receipt', message: 'Aroha Demo is now assigned to Whitford.', action: 'assign_site', targetId: 'assignment-1' };
    }
  `,
  "test-ui": ["buttons", "card", "tokens"].map((name) => `export * from '${mobile}/ui/${name}.${name === "tokens" ? "ts" : "tsx"}';`).join("\n"),
};

const server = await createServer({
  configFile: false, root, server: { host: "127.0.0.1", port: 0 }, esbuild: { jsx: "automatic" },
  resolve: { alias: [
    { find: /^react-native$/, replacement: path.join(root, "apps/mobile/node_modules/react-native-web/dist/index.js") },
    { find: "@/owner-assistant-client", replacement: "test-mobile-client" },
    { find: /^@\/ui$/, replacement: "test-ui" },
    { find: "@", replacement: mobile },
    { find: "@tanstack/react-query", replacement: path.join(root, "apps/mobile/node_modules/@tanstack/react-query/build/modern/index.js") },
  ] },
  plugins: [{
    name: "owner-assistant-proof", enforce: "pre",
    resolveId(id) { if (Object.hasOwn(virtual, id)) return `\0${id}`; },
    async load(id) {
      if (id === "\0test-entry") return (await transformWithEsbuild(virtual["test-entry"], "test-entry.jsx", { loader: "jsx", jsx: "automatic" })).code;
      if (id.startsWith("\0")) return virtual[id.slice(1)];
    },
    configureServer(dev) {
      dev.middlewares.use((request, response, next) => {
        if (request.url !== "/web" && request.url !== "/mobile") return next();
        response.setHeader("Content-Type", "text/html");
        response.end('<html><body style="margin:0;background:#121212"><div id="root"></div><script type="module" src="/@id/__x00__test-entry"></script></body></html>');
      });
    },
  }],
});

await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
try {
  const port = server.httpServer.address().port;
  const web = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  web.on("pageerror", (error) => errors.push(`web:${error.message}`));
  const webCalls = [];
  await web.route("**/api/owner-assistant/**", async (route) => {
    const call = { url: route.request().url(), body: route.request().postDataJSON() };
    webCalls.push(call);
    const body = call.url.endsWith("/confirm")
      ? { kind: "receipt", message: "Aroha Demo is now assigned to Whitford.", action: "assign_site", targetId: "assignment-1" }
      : call.body.form?.operation === "assign_site" ? preview
        : call.body.message?.includes("Help me assign") ? assignmentInput
          : call.body.message?.includes("Akila") ? emptyRemittance : preview;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await web.goto(`http://127.0.0.1:${port}/web`);
  await web.getByLabel("Message").fill("Assign Aroha Demo to Whitford");
  await web.getByRole("button", { name: "Send" }).click();
  await web.getByRole("strong").filter({ hasText: "Assign Aroha Demo to Whitford" }).waitFor();
  assert.equal(webCalls.length, 1);
  await web.screenshot({ path: path.join(output, "web-assignment-preview.png"), fullPage: true });
  await web.getByRole("button", { name: "Confirm & save" }).click();
  await web.getByText("Aroha Demo is now assigned to Whitford.").waitFor();
  assert.equal(webCalls[1].body.token, "synthetic-signed-token");
  await web.getByLabel("Message").fill("Help me assign a contractor to a site");
  await web.getByRole("button", { name: "Send" }).click();
  const callsBeforeIncompleteForm = webCalls.length;
  await web.getByRole("button", { name: "Review details" }).click();
  assert.equal(webCalls.length, callsBeforeIncompleteForm);
  await web.getByLabel("Contractor").selectOption("Aroha Demo");
  await web.getByLabel("Site").selectOption("Whitford");
  await web.locator(".assistant-input").screenshot({ path: path.join(output, "web-guided-assignment-input.png") });
  await web.getByRole("button", { name: "Review details" }).click();
  await web.getByText("Review assignment details", { exact: true }).waitFor();
  assert.deepEqual(webCalls.at(-1).body.form, { operation: "assign_site", contractorName: "Aroha Demo", siteName: "Whitford", rateCents: null });
  await web.screenshot({ path: path.join(output, "web-guided-assignment.png"), fullPage: true });
  await web.getByLabel("Message").fill("Show Akila's remittance for last week");
  await web.getByRole("button", { name: "Send" }).click();
  await web.getByText(emptyRemittance.message).waitFor();
  await web.close();

  const native = await browser.newPage({ viewport: { width: 390, height: 844 } });
  native.on("pageerror", (error) => errors.push(`mobile:${error.message}`));
  await native.goto(`http://127.0.0.1:${port}/mobile`);
  await native.getByLabel("Message CleanTrack assistant").fill("Help me check a remittance");
  await native.getByRole("button", { name: "Send message" }).click();
  await native.getByRole("button", { name: "Check remittance" }).click();
  await native.getByText("Choose a contractor to continue.").waitFor();
  await native.getByLabel("Contractor: Aroha Demo").click();
  await native.screenshot({ path: path.join(output, "mobile-guided-remittance-input.png"), fullPage: true });
  await native.getByRole("button", { name: "Check remittance" }).click();
  await native.getByText("Verified remittance", { exact: true }).waitFor();
  await native.getByText("$113.75", { exact: false }).waitFor();
  assert.deepEqual(await native.evaluate(() => window.__forms.at(-1)), { operation: "get_remittance", contractorName: "Aroha Demo", weekStart: "2026-10-26" });
  await native.screenshot({ path: path.join(output, "mobile-guided-remittance.png"), fullPage: true });
  await native.getByLabel("Message CleanTrack assistant").fill("Show Akila's remittance for last week");
  await native.getByRole("button", { name: "Send message" }).click();
  await native.getByText(emptyRemittance.message).waitFor();
  await native.getByLabel("Message CleanTrack assistant").fill("Thanks");
  await native.getByRole("button", { name: "Send message" }).click();
  await native.getByText("Assign Aroha Demo to Whitford", { exact: true }).waitFor();
  const lastHistory = await native.evaluate(() => window.__histories.at(-1));
  assert.equal(JSON.stringify(lastHistory).includes("113.75"), false);
  assert.equal(JSON.stringify(lastHistory).includes("approved week"), false);
  await native.close();
  assert.deepEqual(errors, []);
  process.stdout.write("PASS owner assistant guided web assignment and mobile remittance\n");
} finally {
  await browser.close();
  await server.close();
}
