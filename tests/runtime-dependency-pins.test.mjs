import fs from "node:fs";

import { describe, expect, it } from "vitest";

const root = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const mobile = JSON.parse(fs.readFileSync(new URL("../apps/mobile/package.json", import.meta.url), "utf8"));
const core = JSON.parse(fs.readFileSync(new URL("../packages/core/package.json", import.meta.url), "utf8"));
const workspace = fs.readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8");

describe("runtime dependency pins", () => {
  it("pins the app zod copies to the patched 4.6.7 release", () => {
    expect(root.dependencies.zod).toBe("4.6.7");
    expect(mobile.dependencies.zod).toBe("4.6.7");
    expect(core.peerDependencies.zod).toBe("4.6.7");
    expect(root.devDependencies.vite).toBe("8.2.4");
    expect(root.pnpm.overrides).toMatchObject({
      "fast-uri": "3.1.7",
      "node-forge": "1.4.1",
      "source-map-js": "1.2.2",
    });
  });

  it("uses one React 19.3 and TypeScript 6.0.3 graph so Expo SDK 58 stays deduped", () => {
    expect(root.dependencies.react).toBe("19.3.0");
    expect(root.dependencies["react-dom"]).toBe("19.3.0");
    expect(root.dependencies["react-server-dom-webpack"]).toBe("19.3.0");
    expect(mobile.dependencies.react).toBe("19.3.0");
    expect(mobile.dependencies["react-native"]).toBe("0.88.0");
    expect(root.devDependencies.typescript).toBe("6.0.3");
    expect(mobile.devDependencies.typescript).toBe("~6.0.3");
    expect(root.devDependencies["@types/react"]).toBe("19.3.0");
    expect(mobile.devDependencies["@types/react"]).toBe("~19.3.0");
  });

  it("keeps the audit exception limited to the Expo CLI zod 3 advisory", () => {
    expect(workspace).toContain("GHSA-mrhx-c7xc-m3w5");
    expect(workspace.match(/GHSA-[0-9a-z-]+/g)).toEqual(["GHSA-mrhx-c7xc-m3w5"]);
  });
});
