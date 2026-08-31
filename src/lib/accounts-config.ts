export const AUTH_MIN_PASSWORD_LENGTH = 12;

export function parseTrustedOrigins(baseURL: string | undefined, extra = ""): string[] {
  const origins = new Set<string>();
  for (const candidate of [baseURL, ...extra.split(",")]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    try {
      origins.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed operator configuration; requests fail closed below.
    }
  }
  return [...origins];
}

export function usesSecureCookies(baseURL: string | undefined): boolean {
  return Boolean(baseURL?.startsWith("https://"));
}

export function isTrustedMutationRequest(request: Request, trustedOrigins: string[]): boolean {
  const cookie = request.headers.get("cookie");
  if (!cookie) return true;
  const origin = request.headers.get("origin");
  return Boolean(origin && trustedOrigins.includes(origin));
}

export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
