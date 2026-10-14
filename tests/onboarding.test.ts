import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { onboardingAdvancesOnError, onboardingStep } from "../src/lib/onboarding";

const openBusiness = { onboardingCompletedAt: null };
const completedBusiness = { onboardingCompletedAt: "2026-10-14T01:02:03.000Z" };

describe("onboardingStep", () => {
  it("starts at the business profile when the owner has no membership", () => {
    expect(onboardingStep({
      business: null,
      activeSiteCount: 2,
      activeContractorCount: 2,
      activeAssignmentCount: 2,
    })).toBe("business");
  });

  it("hides the guide after onboarding is completed", () => {
    expect(onboardingStep({
      business: completedBusiness,
      activeSiteCount: 0,
      activeContractorCount: 0,
      activeAssignmentCount: 0,
    })).toBeNull();
  });

  it("asks for a site when the business has no active sites", () => {
    expect(onboardingStep({
      business: openBusiness,
      activeSiteCount: 0,
      activeContractorCount: 1,
      activeAssignmentCount: 1,
    })).toBe("site");
  });

  it("asks for a contractor when the business has sites but no contractors", () => {
    expect(onboardingStep({
      business: openBusiness,
      activeSiteCount: 2,
      activeContractorCount: 0,
      activeAssignmentCount: 0,
    })).toBe("contractor");
  });

  it("asks for an assignment when sites and contractors are not connected", () => {
    expect(onboardingStep({
      business: openBusiness,
      activeSiteCount: 1,
      activeContractorCount: 1,
      activeAssignmentCount: 0,
    })).toBe("assignment");
  });

  it("offers the optional schedule once an assignment exists", () => {
    expect(onboardingStep({
      business: openBusiness,
      activeSiteCount: 1,
      activeContractorCount: 1,
      activeAssignmentCount: 1,
    })).toBe("schedule");
  });
});

describe("onboardingAdvancesOnError", () => {
  it("reloads only when the saved entity already exists", () => {
    expect(onboardingAdvancesOnError("duplicate_site")).toBe(true);
    expect(onboardingAdvancesOnError("duplicate_contractor")).toBe(true);
    expect(onboardingAdvancesOnError("duplicate_assignment")).toBe(true);
    expect(onboardingAdvancesOnError("schedule_exists")).toBe(true);
    expect(onboardingAdvancesOnError("not_found")).toBe(false);
    expect(onboardingAdvancesOnError("invalid_request")).toBe(false);
  });
});

describe("dashboard onboarding guide source", () => {
  const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");

  it("keeps the empty week mounted and posts the business profile without a business id", () => {
    expect(dashboard).toContain('title="No shifts this week"');
    expect(dashboard).toContain('<EmptyState title="No shifts this week" body="Record the first shift after adding a contractor and assigning them to a site." />');
    expect(dashboard).toContain('data-feature="owner-onboarding"');
    expect(dashboard).toContain('"/api/business"');
    expect(dashboard).toContain('"/api/business/onboarding/complete"');
    expect(dashboard).toContain('timezone: "Pacific/Auckland"');
    expect(dashboard).toContain('currency: "NZD"');
    expect(dashboard).toContain('weekStart: "monday"');
    expect(dashboard).not.toContain("businessId");
    expect(dashboard).not.toContain("ownerUserId");
    expect(dashboard).not.toContain("owner_user_id");
    expect(dashboard).not.toContain("localStorage");
  });
});
