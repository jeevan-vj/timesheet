import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";

// Browser interaction proof for the real sheet/buttons and React Query mutation.
// Native decoration and network I/O are adapters; no API or production credentials are used.
const root = process.cwd();
const mobile = path.join(root, "apps/mobile/src");
const output = path.join(root, "docs/verification/mobile-status-remittance");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});

async function scenario() {
  const virtual = {
    "test-entry": `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { OwnerShiftSheet } from '${mobile}/components/owner-shift-sheet.tsx';
      window.__calls = [];
      const sample = { id: 'synthetic_1', contractorId: 'demo', contractorName: 'Demo Contractor',
        siteId: 'demo-site', siteName: 'Demo Site', workDate: '2026-10-26', startMinutes: 0,
        endMinutes: 60, breakMinutes: 0, paidMinutes: 60, rateCents: 3000, notes: '',
        entryMode: 'paid_hours', occurrenceKind: 'scheduled', scheduleVersionId: 'demo-schedule' };
      function App() {
        const [entry, setEntry] = useState(sample);
        const [approval, setApproval] = useState('open');
        window.__setApproval = setApproval;
        window.__open = (kind = 'scheduled') => { setApproval('open'); setEntry({ ...sample, id: crypto.randomUUID(), occurrenceKind: kind }); };
        return <OwnerShiftSheet entry={entry} approvalStatus={approval} onClose={() => setEntry(null)} />;
      }
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({defaultOptions: { mutations: {retry: false}}})}><App /></QueryClientProvider>);
    `,
    "test-api": `export async function mobileFetch(path, init) {
      window.__calls.push({ path, body: JSON.parse(init.body) });
      await new Promise(resolve => { window.__settle = resolve; });
      return { status: 200, json: async () => ({ ok: true }) };
    }`,
    "test-ui": ["buttons", "list-row", "sheet", "status-pill", "tokens"]
      .map((name) => `export * from '${mobile}/ui/${name}.tsx';`.replace("tokens.tsx", "tokens.ts")).join("\n"),
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
      name: "owner-sheet-synthetic-proof",
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
          response.end('<html><body style="background:#121212"><div id="root"></div><script type="module" src="/@id/__x00__test-entry"></script></body></html>');
        });
      },
    }],
  });
  await server.listen();
  const port = server.httpServer.address().port;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const calls = () => page.evaluate(() => window.__calls.length);
  const open = async (kind = "scheduled") => { await page.evaluate((value) => window.__open(value), kind); };
  try {
    await page.goto(`http://127.0.0.1:${port}/proof`);
    const absent = page.getByRole("button", { name: "Didn't work", exact: true });
    await absent.waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Close shift actions"]')?.getBoundingClientRect().bottom <= window.innerHeight);
    {
      await absent.click();
      await page.getByText(/sets paid time to 0/).waitFor();
      assert.equal(await calls(), 0);
      await page.screenshot({ path: path.join(output, "absence-confirmation.png") });
      await page.getByRole("button", { name: "Cancel paid-hours change" }).click();
      assert.equal(await calls(), 0);
      await absent.click();
      await page.getByRole("button", { name: "Close shift actions" }).click();
      assert.equal(await calls(), 0);
      await open();
      await absent.click();
      await page.evaluate(() => {
        const confirm = document.querySelector('[aria-label="Confirm didn’t work and set paid time to zero"]');
        confirm.click();
        confirm.click();
      });
      await page.waitForFunction(() => window.__calls.length === 1);
      assert.deepEqual(await page.evaluate(() => window.__calls[0].body), { kind: "absent", scope: "this_day" });
      await page.evaluate(() => window.__settle());
      await page.waitForFunction(() => !document.querySelector('[aria-label="Close shift actions"]'));
      await open();
      await page.getByRole("button", { name: "Change hours (this day only)", exact: true }).click();
      await page.getByRole("button", { name: /Save .* for this day only/ }).waitFor();
      await page.evaluate(() => window.__setApproval("approved"));
      await page.getByRole("button", { name: /Save .* for this day only/ }).waitFor({ state: "hidden" });
      assert.equal(await calls(), 1);
      await open("hours_override");
      assert.equal(await page.getByRole("button", { name: /Worked. This shift has custom paid hours/ }).isDisabled(), true);
      await page.getByRole("button", { name: "Reset to pending (restore scheduled hours)", exact: true }).click();
      await page.getByText(/replaces the current paid hours/).waitFor();
      assert.equal(await calls(), 1);
      await page.screenshot({ path: path.join(output, "reset-confirmation.png") });
      await page.getByRole("button", { name: "Cancel paid-hours change" }).click();
      assert.equal(await calls(), 1);
      await open();
      await page.getByRole("button", { name: "Worked", exact: true }).click();
      await page.waitForFunction(() => window.__calls.length === 2);
      await page.getByRole("button", { name: "Close shift actions" }).click();
      await open();
      assert.equal(await page.getByRole("button", { name: "Worked", exact: true }).isDisabled(), true);
      await page.evaluate(() => window.__settle());
      await page.waitForFunction(() => document.querySelector('[aria-label="Worked"]')?.getAttribute('aria-disabled') !== 'true');
      await page.getByRole("button", { name: "Worked", exact: true }).click();
      await page.waitForFunction(() => window.__calls.length === 3);
      await page.evaluate(() => window.__settle());
    }
    assert.deepEqual(errors, []);
    process.stdout.write("PASS owner sheet committed enabled interactions\n");
  } finally {
    await page.close();
    await server.close();
  }
}

try { await scenario(); } finally { await browser.close(); }
