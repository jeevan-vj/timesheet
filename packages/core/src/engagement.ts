export const ENGAGEMENT_STATUSES = ["draft", "invited", "active", "suspended", "archived"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export function gstNumberDigits(value: string): string {
  return value.trim().replace(/[\s-]/g, "");
}

export function contractorMayHoldPortalAccess(status: EngagementStatus): boolean {
  return status === "invited" || status === "active";
}
