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
}) {
  return betterAuth({
    secret: input.secret,
    baseURL: input.baseURL,
    database: drizzleAdapter(input.db, { provider: "sqlite", schema: authSchema }),
    plugins: [expo()],
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
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
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
