import type { ViewerRole } from "./api-config";

export type MobileWorkspace = "contractor" | "owner" | "none";

export function workspaceForRole(role: ViewerRole): MobileWorkspace {
  if (role === "owner") return "owner";
  if (role === "none") return "none";
  return "contractor";
}
