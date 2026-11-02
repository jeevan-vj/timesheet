import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const script = path.resolve("scripts/prepare-factory-wrangler.mjs");

describe("Factory Wrangler preparation", () => {
  it("removes only the generated AI binding for credential-free Factory E2E", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cleantrack-factory-wrangler-"));
    const output = path.join(root, "dist/server");
    fs.mkdirSync(output, { recursive: true });
    const config = { name: "cleantrack", ai: { binding: "AI" }, d1_databases: [{ binding: "DB" }] };
    fs.writeFileSync(path.join(output, "wrangler.json"), JSON.stringify(config));
    execFileSync(process.execPath, [script], { cwd: root, env: { ...process.env, FACTORY_E2E_BASE_URL: "http://127.0.0.1:8787" } });
    expect(JSON.parse(fs.readFileSync(path.join(output, "wrangler.json"), "utf8"))).toEqual({ name: "cleantrack", d1_databases: [{ binding: "DB" }] });
    fs.rmSync(root, { recursive: true, force: true });
  });
});
