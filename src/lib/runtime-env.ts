import { env } from "cloudflare:workers";
import { trustedOriginsFor, usesSecureCookies } from "@/lib/accounts-config";

export function getTrustedOrigins(): string[] {
  return trustedOriginsFor(env.BETTER_AUTH_URL, env.AUTH_TRUSTED_ORIGINS);
}

export function getSecureCookies(): boolean {
  return usesSecureCookies(env.BETTER_AUTH_URL);
}

export function getBetterAuthUrl(): string {
  return env.BETTER_AUTH_URL;
}

export type EmailConfig = { apiKey: string; from: string };

export function getEmailConfig(): EmailConfig {
  return {
    apiKey: optionalEnv("RESEND_API_KEY"),
    from: optionalEnv("EMAIL_FROM"),
  };
}

function optionalEnv(name: "RESEND_API_KEY" | "EMAIL_FROM"): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}
