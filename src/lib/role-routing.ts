export type AccountRole = "owner" | "contractor" | "unassigned";

export function landingPathForRole(role: AccountRole): "/dashboard" | "/contractor" {
  return role === "contractor" ? "/contractor" : "/dashboard";
}

export async function authenticatedLandingPath(): Promise<"/dashboard" | "/contractor"> {
  const response = await fetch("/api/account/role", { cache: "no-store" });
  if (!response.ok) return "/dashboard";
  const body = await response.json() as { role?: AccountRole };
  return landingPathForRole(body.role ?? "unassigned");
}
