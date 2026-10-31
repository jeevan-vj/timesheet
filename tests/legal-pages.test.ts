import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("public legal pages", () => {
  it("publishes stable privacy and terms routes with the approved contact", () => {
    const privacy = read("src/app/privacy/page.tsx");
    const terms = read("src/app/terms/page.tsx");
    for (const source of [privacy, terms]) {
      expect(source).toContain("30 October 2026");
      expect(source).toContain("jeevan90wijerathna@gmail.com");
      expect(source).toContain("LegalPage");
    }
    expect(privacy).toContain("Sign in with Google");
    expect(privacy).toContain("does not sell personal information");
    expect(terms).toContain("snapshotted rates");
    expect(terms).toContain("does not provide tax, GST, employment, legal, or accounting advice");
  });

  it("links the legal routes from the public landing page", () => {
    const home = read("src/app/page.tsx");
    expect(home).toContain('href="/privacy"');
    expect(home).toContain('href="/terms"');
    expect(home).toContain('aria-label="Legal"');
  });
});
