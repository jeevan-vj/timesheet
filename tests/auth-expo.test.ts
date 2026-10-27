import { drizzle } from "drizzle-orm/sql-js";
import { describe, expect, it } from "vitest";
import { createAuth } from "../src/lib/auth-options";
import { CLEANTRACK_APP_SCHEME, trustedOriginsFor } from "../src/lib/accounts-config";
import { openPortalSqlite, sqlRows } from "./portal-db";

const BASE_URL = "https://app.example.test";
const SECRET = "test-secret-test-secret-test-secret";
const PASSWORD = "test-password-12";
const SIGN_IN_IP = "203.0.113.20";
const SIGN_UP_IP = "203.0.113.10";

function postAuth(auth: ReturnType<typeof createAuth>, path: string, headers: Record<string, string>, body: unknown) {
  return auth.handler(new Request(`${BASE_URL}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  }));
}

describe("Better Auth Expo server", () => {
  it("keeps the expo plugin, sign-in and sign-up limits, and CSRF checks", async () => {
    const sqlite = await openPortalSqlite();
    const auth = createAuth({
      secret: SECRET,
      baseURL: BASE_URL,
      db: drizzle(sqlite),
      trustedOrigins: trustedOriginsFor(BASE_URL),
      secureCookies: true,
    });
    expect(auth.options.plugins?.map((plugin) => plugin.id)).toEqual(["expo"]);
    expect(auth.options.trustedOrigins).toContain(CLEANTRACK_APP_SCHEME);
    expect(auth.options.advanced?.disableCSRFCheck).toBe(false);
    expect(auth.options.advanced?.disableOriginCheck).toBe(false);
    expect(auth.options.rateLimit).toMatchObject({
      enabled: true,
      storage: "database",
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 3 },
      },
    });

    const signUp = { name: "Owner", email: "owner@example.test", password: PASSWORD };
    for (const email of ["one@example.test", "two@example.test", "three@example.test"]) {
      const created = await postAuth(auth, "sign-up/email", {
        origin: BASE_URL,
        "cf-connecting-ip": SIGN_UP_IP,
      }, { ...signUp, email });
      expect(created.status).toBe(200);
    }
    const limitedSignUp = await postAuth(auth, "sign-up/email", {
      origin: BASE_URL,
      "cf-connecting-ip": SIGN_UP_IP,
    }, { ...signUp, email: "four@example.test" });
    expect(limitedSignUp.status).toBe(429);
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM user")).toEqual([[3]]);

    const credentials = { email: "one@example.test", password: PASSWORD };
    const browser = await postAuth(auth, "sign-in/email", {
      origin: BASE_URL,
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(browser.status).toBe(200);
    const sessionCookie = browser.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    expect(sessionCookie).toContain("session_token=");

    const mobile = await postAuth(auth, "sign-in/email", {
      cookie: "better-auth.session_token=present",
      "expo-origin": CLEANTRACK_APP_SCHEME,
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(mobile.status).toBe(200);

    const foreignScheme = await postAuth(auth, "sign-in/email", {
      cookie: "better-auth.session_token=present",
      "expo-origin": "https://evil.example",
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(foreignScheme.status).toBe(403);

    const noOrigin = await postAuth(auth, "sign-in/email", {
      cookie: "better-auth.session_token=present",
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(noOrigin.status).toBe(403);

    const crossSite = await postAuth(auth, "sign-in/email", {
      cookie: "better-auth.session_token=present",
      origin: "https://evil.example",
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(crossSite.status).toBe(403);

    const limitedSignIn = await postAuth(auth, "sign-in/email", {
      origin: BASE_URL,
      "cf-connecting-ip": SIGN_IN_IP,
    }, credentials);
    expect(limitedSignIn.status).toBe(429);

    const session = await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) });
    expect(session?.user.email).toBe("one@example.test");
    expect(await auth.api.getSession({ headers: new Headers() })).toBeNull();
  });
});
