import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contractorPageDestination } from "../src/lib/contractor-route-guard";

describe("contractor page server guard", () => {
  it("renders only for a currently authorized contractor role", () => {
    expect(contractorPageDestination(null)).toBe("/sign-in");
    expect(contractorPageDestination("owner")).toBe("/dashboard");
    expect(contractorPageDestination("unassigned")).toBe("/");
    expect(contractorPageDestination("contractor")).toBeNull();
  });

  it("enforces the role before the contractor route renders", () => {
    const source = fs.readFileSync(path.resolve("src/app/contractor/page.tsx"), "utf8");
    expect(source).not.toMatch(/^\s*["']use client["']/);
    expect(source).toMatch(/auth\.api\.getSession/);
    expect(source).toMatch(/await accountRole/);
    expect(source).toMatch(/if \(destination\) redirect\(destination\)/);
  });
});
