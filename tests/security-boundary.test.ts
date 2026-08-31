import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function filesUnder(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

describe("confidential data boundary", () => {
  it("does not log domain request bodies or payroll fields", () => {
    const source = filesUnder(path.resolve("src"))
      .filter((file) => /\.(ts|tsx)$/.test(file))
      .map((file) => fs.readFileSync(file, "utf8"))
      .join("\n");
    expect(source).not.toMatch(/console\.(log|info|debug)\s*\(/);
    expect(source).not.toMatch(/console\.error\([^)]*(rateCents|notes|email|request\.json)/s);
  });
});
