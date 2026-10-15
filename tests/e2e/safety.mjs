export const PRODUCTION_HOSTS = ["cleantrack-timesheet.jeevan90wijerathna.workers.dev"];

export function assertSafeBaseUrl(baseUrl, env = process.env) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Base URL is not valid.");
  }
  const host = url.hostname.toLowerCase();
  if (PRODUCTION_HOSTS.includes(host)) {
    throw new Error(`Refusing production host ${host}.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must be http or https.");
  }
  const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!loopback) {
    if (env.VERIFY_E2E_ALLOW_PREVIEW !== "1") {
      throw new Error("Refusing non-local base URL. Set VERIFY_E2E_ALLOW_PREVIEW=1 only for a PR preview.");
    }
    if (url.protocol !== "https:") throw new Error("A preview base URL must use https.");
    if (!host.includes("preview")) throw new Error("A preview host must include 'preview'.");
  }
  return url.origin;
}
