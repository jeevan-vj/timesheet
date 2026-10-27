export const MOBILE_CLIENT_HEADER = "X-CleanTrack-Client";
export const PRODUCTION_API_URL = "https://cleantrack-timesheet.jeevan90wijerathna.workers.dev";

const MOBILE_CLIENT_VALUE = /^mobile\/[0-9A-Za-z][0-9A-Za-z._+-]{0,31}$/;

export function resolveApiBaseUrl(sources = {}) {
  return httpBase(sources.publicUrl) ?? httpBase(sources.extraUrl) ?? PRODUCTION_API_URL;
}

export function mobileClientValue(version) {
  const value = `mobile/${String(version ?? "").trim()}`;
  return MOBILE_CLIENT_VALUE.test(value) ? value : "mobile/0";
}

export function buildApiRequest(input) {
  const baseUrl = httpBase(input.baseUrl);
  if (!baseUrl) throw new Error("invalid_api_base");
  const headers = new Headers(input.headers);
  headers.set(MOBILE_CLIENT_HEADER, mobileClientValue(input.version));
  const transport = input.transport === "web" ? "web" : "native";
  if (transport === "web") headers.delete("cookie");
  else {
    const cookie = typeof input.cookie === "string" ? input.cookie.trim() : "";
    if (cookie) headers.set("cookie", cookie);
  }
  return {
    url: `${baseUrl}${apiPath(input.path)}`,
    headers: Object.fromEntries(headers.entries()),
    credentials: transport === "web" ? "include" : "omit",
  };
}

export function viewerRole(viewer) {
  const owner = viewer?.owner != null;
  const contractor = Array.isArray(viewer?.contractorOf) && viewer.contractorOf.length > 0;
  if (owner && contractor) return "owner_and_contractor";
  if (contractor) return "contractor";
  if (owner) return "owner";
  return "none";
}

export function roleLabel(role) {
  if (role === "contractor") return "Contractor";
  if (role === "owner") return "Owner";
  if (role === "owner_and_contractor") return "Owner and contractor";
  return "No workspace yet";
}

export function signInErrorMessage(input = {}) {
  if (input.offline) return "Could not reach CleanTrack. Check your connection and try again.";
  if (input.status === 429) return "Too many attempts. Try again in a minute.";
  return "Email or password was not recognised.";
}

export function sessionEndsOnStatus(status) {
  return status === 401;
}

function httpBase(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}${path}`;
}

function apiPath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    throw new Error("invalid_api_path");
  }
  return path;
}
