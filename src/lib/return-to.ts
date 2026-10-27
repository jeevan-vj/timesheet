const ALLOWED_RETURN_TO = new Set(["/invite", "/portal", "/dashboard"]);

export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== "string") return "/dashboard";
  const candidate = value.trim();
  if (!isRelativeReturn(candidate)) return "/dashboard";
  const path = candidate.split(/[?#]/, 1)[0] ?? "";
  if (!ALLOWED_RETURN_TO.has(path)) return "/dashboard";
  return path;
}

function isRelativeReturn(candidate: string): boolean {
  if (candidate.length === 0 || candidate.length > 64) return false;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return false;
  return !candidate.includes("\\") && !candidate.includes("://") && !candidate.includes("%");
}
