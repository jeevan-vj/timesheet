import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { betterAuth } from "better-auth";
import { authSchema } from "@/db/schema";
import { AUTH_MIN_PASSWORD_LENGTH } from "@/lib/accounts-config";

export type AuthDatabase = Parameters<typeof drizzleAdapter>[0];

export function createAuth(input: {
  secret: string | undefined;
  baseURL: string | undefined;
  db: AuthDatabase;
  trustedOrigins: string[];
  secureCookies: boolean;
  googleClientId?: string;
  googleClientSecret?: string;
}) {
  const googleClientId = input.googleClientId?.trim();
  const googleClientSecret = input.googleClientSecret?.trim();
  const google = googleClientId && googleClientSecret
    ? { clientId: googleClientId, clientSecret: googleClientSecret, prompt: "select_account" as const }
    : undefined;

  return betterAuth({
    secret: input.secret,
    baseURL: input.baseURL,
    database: drizzleAdapter(input.db, { provider: "sqlite", schema: authSchema }),
    plugins: [expo()],
    socialProviders: google ? { google } : undefined,
    trustedOrigins: input.trustedOrigins,
    telemetry: { enabled: false },
    logger: { disabled: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: AUTH_MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google"],
        requireLocalEmailVerified: false,
        disableImplicitLinking: false,
        allowDifferentEmails: false,
      },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
        "/sign-in/social": { window: 60, max: 10 },
      },
    },
    advanced: {
      useSecureCookies: input.secureCookies,
      disableCSRFCheck: false,
      disableOriginCheck: false,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: input.secureCookies, path: "/" },
    },
  });
}
