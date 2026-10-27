export const AUTH_MIN_PASSWORD_LENGTH = 12;
export const MOBILE_CLIENT_HEADER = "x-cleantrack-client";
export const CLEANTRACK_APP_SCHEME = "cleantrack://";
export const CLEANTRACK_PREVIEW_SCHEME = "cleantrack-preview://";

const MOBILE_CLIENT_VALUE = /^mobile\/[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;
const LOCAL_EXPO_ORIGINS = ["exp://", "exp://**", "exp://192.168.*.*:*/**"];
const PREVIEW_AUTH_HOST = "cleantrack-timesheet-preview.jeevan90wijerathna.workers.dev";

export function parseTrustedOrigins(baseURL: string | undefined, extra = ""): string[] {
  const origins = new Set<string>();
  for (const candidate of [baseURL, ...extra.split(",")]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const origin = httpOrigin(trimmed);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

export function mobileSchemeOrigins(baseURL: string | undefined): string[] {
  const schemes = [CLEANTRACK_APP_SCHEME];
  if (isLoopbackHttp(baseURL)) schemes.push(CLEANTRACK_PREVIEW_SCHEME, ...LOCAL_EXPO_ORIGINS);
  else if (isPreviewHost(baseURL)) schemes.push(CLEANTRACK_PREVIEW_SCHEME);
  return schemes;
}

export function trustedOriginsFor(baseURL: string | undefined, extra = ""): string[] {
  return [...parseTrustedOrigins(baseURL, extra), ...mobileSchemeOrigins(baseURL)];
}

export function usesSecureCookies(baseURL: string | undefined): boolean {
  return Boolean(baseURL?.startsWith("https://"));
}

export function isTrustedMutationRequest(request: Request, trustedOrigins: string[]): boolean {
  if (!request.headers.get("cookie")) return true;
  const origin = request.headers.get("origin");
  if (origin) return trustedOrigins.includes(origin);
  return MOBILE_CLIENT_VALUE.test(request.headers.get(MOBILE_CLIENT_HEADER) ?? "");
}

function httpOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    if (!origin.startsWith("http://") && !origin.startsWith("https://")) return null;
    return origin;
  } catch {
    return null;
  }
}

function isLoopbackHttp(baseURL: string | undefined): boolean {
  const url = authUrl(baseURL);
  return url?.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

function isPreviewHost(baseURL: string | undefined): boolean {
  return authUrl(baseURL)?.hostname === PREVIEW_AUTH_HOST;
}

function authUrl(baseURL: string | undefined): URL | null {
  if (!baseURL) return null;
  try {
    return new URL(baseURL);
  } catch {
    return null;
  }
}

export function noStoreJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
