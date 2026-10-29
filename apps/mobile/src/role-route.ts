import type { ViewerRole } from "./api-config";
import type { ContractorLink } from "./me-response";

export type MobileWorkspace = "contractor" | "owner" | "none";
export type WorkspaceChoice = Exclude<MobileWorkspace, "none">;

export function workspaceForRole(role: ViewerRole, storedChoice: WorkspaceChoice | null = null): MobileWorkspace {
  if (role === "owner") return "owner";
  if (role === "contractor") return "contractor";
  if (role === "owner_and_contractor") return storedChoice ?? "owner";
  if (role === "none") return "none";
  return "none";
}

export function workspaceSwitchAvailable(role: ViewerRole): boolean {
  return role === "owner_and_contractor";
}

export function nextWorkspace(workspace: WorkspaceChoice): WorkspaceChoice {
  return workspace === "owner" ? "contractor" : "owner";
}

export function contractorWorkspaceLabel(links: readonly ContractorLink[]): string {
  const names = links.map((link) => link.businessName.trim()).filter(Boolean);
  if (names.length === 0) return "My work";
  if (names.length === 1) return `My work at ${names[0]}`;
  if (names.length === 2) return `My work at ${names[0]} and ${names[1]}`;
  return `My work at ${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}
