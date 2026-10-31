import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const portal = readFileSync("src/components/portal-home.tsx", "utf8");

describe("contractor web portal", () => {
  it("loads assigned work and approved remittance details from contractor-scoped routes", () => {
    expect(portal).toContain('fetch("/api/portal/upcoming?days=14"');
    expect(portal).toContain('fetch(`/api/portal/payments?week=${weekStart}`');
    expect(portal).toContain('fetch(`/api/portal/payments/${weekStart}`');
    expect(portal).toContain("portalUpcomingSchema.parse");
    expect(portal).toContain("portalPaymentsSchema.parse");
    expect(portal).toContain("portalPaymentDetailSchema.parse");
  });

  it("does not expose the owner remittance route or accept a contractor id", () => {
    expect(portal).not.toContain("/api/contractors/");
    expect(portal).not.toContain("contractorId");
  });
});
