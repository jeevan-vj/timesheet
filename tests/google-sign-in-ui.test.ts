import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Google sign-in UI", () => {
  it("starts the web flow with the allow-listed return path", () => {
    const signIn = source("src/app/sign-in/page.tsx");
    expect(signIn).toContain("authClient.signIn.social");
    expect(signIn).toContain('provider: "google"');
    expect(signIn).toContain("callbackURL: next");
    expect(signIn).toContain('data-testid="google-sign-in"');
  });

  it("offers Google account creation to owners and invited contractors", () => {
    const signUp = source("src/app/sign-up/page.tsx");
    expect(signUp).toContain("authClient.signIn.social");
    expect(signUp).toContain('provider: "google"');
    expect(signUp).toContain("callbackURL: next");
    expect(signUp).toContain('data-testid="google-sign-up"');

    const invitation = source("src/components/invite-accept.tsx");
    expect(invitation).toContain("authClient.signIn.social");
    expect(invitation).toContain('provider: "google"');
    expect(invitation).toContain('callbackURL: "/invite"');
    expect(invitation).toContain('data-testid="invite-google"');
  });

  it("starts the native flow through the Expo client and returns to the role gate", () => {
    const signIn = source("apps/mobile/src/components/sign-in-form.tsx");
    const dependencies = JSON.parse(source("apps/mobile/package.json")) as { dependencies: Record<string, string> };
    expect(signIn).toContain("authClient.signIn.social");
    expect(signIn).toContain('provider: "google"');
    expect(signIn).toContain('callbackURL: "/"');
    expect(signIn).toContain('testID="google-sign-in"');
    expect(signIn).toContain('router.replace("/")');
    expect(dependencies.dependencies["expo-web-browser"]).toBe("~58.0.7");
  });
});
