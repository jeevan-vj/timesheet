import { describe, expect, it } from "vitest";
import { landingPathForRole } from "../src/lib/role-routing";

describe("role routing", () => {
  it("routes contractor-only users away from the owner dashboard", () => {
    expect(landingPathForRole("contractor")).toBe("/contractor");
    expect(landingPathForRole("owner")).toBe("/dashboard");
    expect(landingPathForRole("unassigned")).toBe("/dashboard");
  });
});
