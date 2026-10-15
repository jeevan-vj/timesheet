export type OnboardingStep = "business" | "site" | "contractor" | "assignment" | "schedule";

const STEPS_THAT_ALREADY_EXIST = new Set([
  "duplicate_site",
  "duplicate_contractor",
  "duplicate_assignment",
  "schedule_exists",
]);

export function onboardingStep(input: {
  business: { onboardingCompletedAt: string | null } | null;
  activeSiteCount: number;
  activeContractorCount: number;
  activeAssignmentCount: number;
}): OnboardingStep | null {
  if (input.business === null) return "business";
  if (input.business.onboardingCompletedAt !== null) return null;
  if (input.activeSiteCount < 1) return "site";
  if (input.activeContractorCount < 1) return "contractor";
  if (input.activeAssignmentCount < 1) return "assignment";
  return "schedule";
}

export function onboardingAdvancesOnError(code: string): boolean {
  return STEPS_THAT_ALREADY_EXIST.has(code);
}
