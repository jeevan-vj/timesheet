import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { createServer, transformWithEsbuild } from "vite";

const root = process.cwd();
const mobile = path.join(root, "apps/mobile/src");
const output = path.join(root, "docs/verification/mobile-contractor-remittance");
await fs.mkdir(output, { recursive: true });

const virtual = {
  "test-entry": `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import PayScreen from '${mobile}/app/(contractor)/(tabs)/pay.tsx';
    createRoot(document.getElementById('root')).render(<PayScreen />);
  `,
  "test-portal-client": `
    const noop = async () => {};
    export function usePortalPayments() {
      return { data: {
        headline: { weekStart: '2026-10-26', weekEnd: '2026-11-01', paidMinutes: 60, payCents: 3200, estimated: true },
        weeks: [{ weekStart: '2026-10-19', weekEnd: '2026-10-25', paidMinutes: 150, payCents: 5600 }]
      }, isPending: false, isError: false, isRefetching: false, refetch: noop };
    }
    export function usePortalPaymentDetail(week) {
      return { data: week ? {
        weekStart: '2026-10-19', weekEnd: '2026-10-25', paidMinutes: 150, payCents: 5600,
        lines: [{ id: 'line-1', businessId: 'biz-1', workDate: '2026-10-20', siteName: 'Whitford', businessName: 'Demo Cleaning', paidMinutes: 150, payCents: 5600 }],
        remittances: [{ businessId: 'biz-1', businessName: 'Demo Cleaning' }]
      } : undefined, isPending: false, isError: false, isRefetching: false, refetch: noop };
    }
  `,
  "test-remittance-native": `
    export async function shareContractorRemittance(target) { window.__sharedRemittance = target; }
  `,
  "test-route-error": "export function ErrorBoundary() { return null; }",
  "test-ui": `
    export { SecondaryButton } from '${mobile}/ui/buttons.tsx';
    export { EmptyState } from '${mobile}/ui/empty-state.tsx';
    export { ErrorState } from '${mobile}/ui/error-state.tsx';
    export { ListRow } from '${mobile}/ui/list-row.tsx';
    export { SectionHeader } from '${mobile}/ui/section-header.tsx';
    export { Sheet } from '${mobile}/ui/sheet.tsx';
    export { Skeleton } from '${mobile}/ui/skeleton.tsx';
    export { StatTile } from '${mobile}/ui/stat-tile.tsx';
    export { StatusPill } from '${mobile}/ui/status-pill.tsx';
    export { spacing, statusColors, theme, typeScale } from '${mobile}/ui/tokens.ts';
    export function Screen({ children }) { return children; }
  `,
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
    { find: "@/portal-client", replacement: "test-portal-client" },
    { find: "@/contractor-remittance-native", replacement: "test-remittance-native" },
    { find: "@/components/route-error-boundary", replacement: "test-route-error" },
    { find: /^@\/ui$/, replacement: "test-ui" },
    { find: "@", replacement: mobile },
  ] },
  plugins: [{
    name: "contractor-remittance-proof",
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
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const port = server.httpServer.address().port;
  await page.goto(`http://127.0.0.1:${port}/proof`);
  await page.getByText("19 Oct – 25 Oct").click();
  await page.getByText("Whitford", { exact: true }).waitFor();
  const action = page.getByRole("button", { name: "View or download remittance PDF" });
  assert.equal(await action.isVisible(), true);
  await page.screenshot({ path: path.join(output, "approved-week-remittance.png"), fullPage: true });
  await action.click();
  await page.waitForFunction(() => window.__sharedRemittance?.businessId === "biz-1");
  assert.deepEqual(await page.evaluate(() => window.__sharedRemittance), {
    businessId: "biz-1", businessName: "Demo Cleaning", weekStart: "2026-10-19", weekEnd: "2026-10-25",
  });
  assert.deepEqual(errors, []);
  process.stdout.write("PASS contractor approved-week remittance action\n");
} finally {
  await page.close();
  await browser.close();
  await server.close();
}
