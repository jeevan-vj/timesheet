import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("invite response cache policy", () => {
  it("sets no-store on token-bearing invite pages", async () => {
    const rules = await nextConfig.headers();
    expect(rules).toContainEqual({
      source: "/invite/:token*",
      headers: [{ key: "Cache-Control", value: "no-store" }],
    });
  });
});
