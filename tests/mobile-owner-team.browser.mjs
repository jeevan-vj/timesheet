import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";

const root = process.cwd();
const mobile = path.join(root, "apps/mobile/src");
const output = path.join(root, "docs/verification/mobile-owner-team");
await fs.mkdir(output, { recursive: true });

const virtual = {
  "test-entry": `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { OwnerContractorFormSheet, OwnerInvitationActions, OwnerContractorLifecycleActions } from '${mobile}/components/owner-contractor-management.tsx';

    window.__shared = [];
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: async (value) => { window.__shared.push(value); } });

    const current = {
      id: 'contractor_demo', name: 'Aroha Demo', email: 'aroha@example.test', phone: '021 555 0101',
      defaultRateCents: 3250, currency: 'NZD', active: true, preferredName: '', startDate: null,
      engagementStatus: 'active', gstRegistered: false, gstNumber: '', internalNotes: '',
      emergencyContactName: '', emergencyContactPhone: '', createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z'
    };
    const none = { state: 'none', expiresAt: null, sendCount: null, lastDelivery: null };
    function App() {
      const [mode, setMode] = useState('form');
      const [contractor, setContractor] = useState(current);
      window.__showArchive = () => setMode('archive');
      return <div style={{maxWidth: 390, margin: '0 auto'}}>
        {mode === 'form' ? <OwnerContractorFormSheet contractor={null} visible onClose={() => {}} onSaved={(saved) => { setContractor(saved); setMode('invite'); }} /> : null}
        {mode === 'invite' ? <OwnerInvitationActions contractor={contractor} invitation={none} /> : null}
        {mode === 'archive' ? <OwnerContractorLifecycleActions contractor={contractor} onEdit={() => {}} onArchived={() => { setContractor({...contractor, active: false, engagementStatus: 'archived'}); setMode('restore'); }} /> : null}
        {mode === 'restore' ? <OwnerContractorLifecycleActions contractor={contractor} onEdit={() => {}} onArchived={() => {}} /> : null}
      </div>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
  `,
  "test-api": `
    window.__calls = [];
    const base = {
      id: 'contractor_demo', name: 'Aroha Demo', email: 'aroha@example.test', phone: '021 555 0101',
      defaultRateCents: 3250, currency: 'NZD', active: true, preferredName: '', startDate: null,
      engagementStatus: 'active', gstRegistered: false, gstNumber: '', internalNotes: '',
      emergencyContactName: '', emergencyContactPhone: '', createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z'
    };
    export async function mobileFetch(path, init) {
      const body = init.body ? JSON.parse(init.body) : null;
      window.__calls.push({ path, method: init.method, body });
      if (path === '/api/contractors') return { status: 201, json: async () => ({ ...base, ...body }) };
      if (path.endsWith('/invitation')) return { status: 201, json: async () => ({
        invitation: { state: 'pending', expiresAt: '2026-11-06T00:00:00.000Z', sendCount: 1, lastDelivery: 'link_only' },
        delivery: 'link_only', inviteLink: 'https://app.example.test/invite#synthetic_secret'
      }) };
      if (path.endsWith('/archive')) return { status: 200, json: async () => ({ ...base, active: false, engagementStatus: 'archived' }) };
      if (path.endsWith('/restore')) return { status: 200, json: async () => base };
      return { status: 500, json: async () => ({ error: 'internal_error' }) };
    }
  `,
  "test-ui": ["buttons", "card", "sheet", "status-pill", "status-tone", "tokens"]
    .map((name) => `export * from '${mobile}/ui/${name}.${name === "tokens" || name === "status-tone" ? "ts" : "tsx"}';`).join("\n"),
  "test-symbol": "export function SymbolView() { return null; }",
  "test-safe-area": "export { View as SafeAreaView } from 'react-native';",
};

const server = await createServer({
  configFile: false,
  root,
  server: { host: "127.0.0.1", port: 0 },
  esbuild: { jsx: "automatic" },
  resolve: { alias: [
    { find: /^react-native$/, replacement: path.join(root, "apps/mobile/node_modules/react-native-web/dist/index.js") },
    { find: "react-native-safe-area-context", replacement: "test-safe-area" },
    { find: "expo-symbols", replacement: "test-symbol" },
    { find: "@/api", replacement: "test-api" },
    { find: /^@\/ui$/, replacement: "test-ui" },
    { find: "@", replacement: mobile },
    { find: "@tanstack/react-query", replacement: path.join(root, "apps/mobile/node_modules/@tanstack/react-query/build/modern/index.js") },
  ] },
  plugins: [{
    name: "owner-team-synthetic-proof",
    enforce: "pre",
    resolveId(id, importer) {
      if (id === "./api" && importer?.endsWith("/owner-mutations-client.ts")) return "\0test-api";
      if (Object.hasOwn(virtual, id)) return `\0${id}`;
    },
    async load(id) {
      if (id === "\0test-entry") return (await transformWithEsbuild(virtual["test-entry"], "test-entry.jsx", { loader: "jsx", jsx: "automatic" })).code;
      if (id.startsWith("\0")) return virtual[id.slice(1)];
    },
    configureServer(dev) {
      dev.middlewares.use("/proof", (_request, response) => {
        response.setHeader("Content-Type", "text/html");
        response.end('<html><body style="margin:0;background:#121212"><div id="root"></div><script type="module" src="/@id/__x00__test-entry"></script></body></html>');
      });
    },
  }],
});

await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());

try {
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/proof`);
  await page.waitForTimeout(500);
  if (await page.getByLabel("Name").count() === 0) {
    throw new Error(`Owner team form did not render: ${JSON.stringify({ errors, body: await page.locator("body").innerText() })}`);
  }
  await page.getByLabel("Name").fill("Aroha Demo");
  await page.getByLabel("Email").fill("bad-email");
  await page.getByLabel("Phone").fill("021 555 0101");
  await page.getByLabel("Default hourly rate (NZD)").fill("14.999");
  await page.getByRole("button", { name: "Add contractor", exact: true }).click();
  await page.getByText("Enter a valid email or leave it blank.").waitFor();
  await page.getByText("Enter an hourly rate from NZ$15.00 to NZ$250.00.").waitFor();
  assert.equal(await page.evaluate(() => window.__calls.length), 0);

  await page.getByLabel("Email").fill("aroha@example.test");
  await page.getByLabel("Default hourly rate (NZD)").fill("32.50");
  await page.screenshot({ path: path.join(output, "add-contractor.png"), fullPage: true });
  await page.getByRole("button", { name: "Add contractor", exact: true }).click();
  await page.getByText("No invitation").waitFor();
  assert.deepEqual(await page.evaluate(() => window.__calls[0]), {
    path: "/api/contractors",
    method: "POST",
    body: { name: "Aroha Demo", email: "aroha@example.test", phone: "021 555 0101", defaultRateCents: 3250 },
  });

  await page.getByRole("button", { name: "Invite Aroha Demo" }).click();
  await page.getByText("Aroha Demo will receive a link to their CleanTrack portal.").waitFor();
  await page.screenshot({ path: path.join(output, "invite-confirmation.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirm send invitation to Aroha Demo" }).click();
  await page.getByRole("button", { name: "Share invitation link for Aroha Demo" }).waitFor();
  await page.getByText("Invitation pending").waitFor();
  assert.equal(await page.getByRole("button", { name: "Invite Aroha Demo" }).count(), 0);
  assert.equal((await page.locator("body").innerText()).includes("synthetic_secret"), false);
  await page.screenshot({ path: path.join(output, "invite-share.png"), fullPage: true });
  await page.getByRole("button", { name: "Share invitation link for Aroha Demo" }).click();
  assert.deepEqual(await page.evaluate(() => window.__shared), [{
    text: "https://app.example.test/invite#synthetic_secret",
    title: "CleanTrack invitation",
    url: undefined,
  }]);

  await page.evaluate(() => window.__showArchive());
  await page.getByRole("button", { name: "Archive Aroha Demo", exact: true }).click();
  await page.getByText("Historical shifts and pay will stay unchanged.").waitFor();
  await page.getByRole("button", { name: "Close archive confirmation" }).click();
  assert.equal(await page.evaluate(() => window.__calls.filter((call) => call.path.endsWith('/archive')).length), 0);
  await page.getByRole("button", { name: "Archive Aroha Demo", exact: true }).click();
  await page.getByRole("button", { name: "Confirm archive Aroha Demo" }).click();
  await page.getByRole("button", { name: "Restore Aroha Demo" }).waitFor();
  await page.getByRole("button", { name: "Restore Aroha Demo" }).click();
  await page.waitForFunction(() => window.__calls.some((call) => call.path.endsWith('/restore')));

  assert.deepEqual(errors, []);
  process.stdout.write("PASS owner team synthetic interactions\n");
} finally {
  await page.close();
  await browser.close();
  await server.close();
}
