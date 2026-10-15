import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { assertSafeBaseUrl } from "./e2e/safety.mjs";

describe("verify-e2e target guard", () => {
  it("allows loopback and refuses production even when a preview override is set", () => {
    expect(assertSafeBaseUrl("http://127.0.0.1:8788")).toBe("http://127.0.0.1:8788");
    expect(() => assertSafeBaseUrl("https://cleantrack-timesheet.jeevan90wijerathna.workers.dev", {
      VERIFY_E2E_ALLOW_PREVIEW: "1",
    })).toThrow(/production/i);
    expect(() => assertSafeBaseUrl("https://example.test")).toThrow(/non-local/i);
    expect(assertSafeBaseUrl("https://cleantrack-timesheet-preview.example.workers.dev", {
      VERIFY_E2E_ALLOW_PREVIEW: "1",
    })).toBe("https://cleantrack-timesheet-preview.example.workers.dev");
  });

  it("does not migrate or boot a remote database", () => {
    const script = fs.readFileSync(new URL("../scripts/verify-e2e.mjs", import.meta.url), "utf8");
    expect(script).not.toContain("--remote");
    expect(script).toContain("--local");
    expect(script).toContain("assertSafeBaseUrl");
  });
});
