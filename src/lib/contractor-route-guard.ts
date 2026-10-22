export type AccountRole = "owner" | "contractor" | "unassigned";

export function contractorPageDestination(role: AccountRole | null): string | null {
  if (role === null) return "/sign-in";
  if (role === "owner") return "/dashboard";
  if (role !== "contractor") return "/";
  return null;
}
