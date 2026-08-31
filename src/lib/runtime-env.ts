import { env } from "cloudflare:workers";
import { parseTrustedOrigins, usesSecureCookies } from "@/lib/accounts-config";

export function getTrustedOrigins(): string[] {
  return parseTrustedOrigins(env.BETTER_AUTH_URL, env.AUTH_TRUSTED_ORIGINS);
}

export function getSecureCookies(): boolean {
  return usesSecureCookies(env.BETTER_AUTH_URL);
}
