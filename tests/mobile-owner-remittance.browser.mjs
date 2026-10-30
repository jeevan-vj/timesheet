import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";

const root = process.cwd();
const mobile = path.join(root, "apps/mobile/src");
const output = path.join(root, "docs/verification/mobile-remittance");
await fs.mkdir(output, { recursive: true });

const virtual = {
  "test-entry": `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { OwnerRemittanceSheet } from '${mobile}/components/owner-remittance-sheet.tsx';
    function App() {
      const [selection, setSelection] = useState({ contractorId: 'contractor-1', contractorName: 'Pasindhu' });
      return <OwnerRemittanceSheet selection={selection} weekStart="2026-10-26" onClose={() => setSelection(null)} />;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `,
  "test-api": `export async function mobileFetch() {
    return { status: 200, json: async () => ({
      reference: 'RA-contractor-1-2026-10-26', filename: 'remittance-pasindhu-2026-11-01.pdf',
      contractorId: 'contractor-1', contractorName: 'Pasindhu', weekStart: '2026-10-26', weekEnd: '2026-11-01',
      remitterName: 'Demo Cleaning', remitterEmail: 'owner@example.test', currency: 'NZD',
      lines: [
        { workDate: '2026-10-27', siteName: 'Whitford', paidMinutes: 60, rateCents: 2000, payCents: 2000 },
        { workDate: '2026-10-29', siteName: 'Albany Offices', paidMinutes: 90, rateCents: 2400, payCents: 3600 }
      ], paidMinutes: 150, payCents: 5600,
      disclaimer: 'Gross contractor payments before tax, GST, expenses, or adjustments.'
    }) };
  }`,
  "test-ui": ["buttons", "empty-state", "list-row", "sheet", "skeleton", "tokens"]
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
  ] },
  plugins: [{
    name: "owner-remittance-proof",
    enforce: "pre",
    resolveId(id) { if (Object.hasOwn(virtual, id)) return `\0${id}`; },
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
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/proof`);
  await page.getByText("RA-contractor-1-2026-10-26").waitFor();
  await page.getByText("Whitford", { exact: true }).waitFor();
  await page.getByText("Albany Offices", { exact: true }).waitFor();
  await page.getByText("$56.00", { exact: true }).waitFor();
  const close = page.getByRole("button", { name: "Close remittance" });
  assert.equal(await close.isVisible(), true);
  await page.screenshot({ path: path.join(output, "owner-remittance.png"), fullPage: true });
  await close.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "owner-remittance-actions.png") });
  await close.click();
  await page.getByText("RA-contractor-1-2026-10-26").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  process.stdout.write("PASS owner remittance in-app viewer\n");
} finally {
  await page.close();
  await browser.close();
  await server.close();
}
