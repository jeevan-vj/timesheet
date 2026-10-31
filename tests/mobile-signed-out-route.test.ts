import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const mobileApp = join(process.cwd(), "apps/mobile/src/app");
const rootLayout = readFileSync(join(mobileApp, "_layout.tsx"), "utf8");

function navigatorSource(name: string): string {
  const start = rootLayout.indexOf(`function ${name}()`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = rootLayout.indexOf("\nfunction ", start + 1);
  return rootLayout.slice(start, end === -1 ? undefined : end);
}

describe("mobile signed-out root route", () => {
  it("redirects the signed-out workspace groups to sign-in", () => {
    const signedOut = navigatorSource("RootNavigator");
    expect(signedOut).toMatch(
      /<Stack\.Protected guard=\{false\} redirectTo="\/sign-in">\s*<Stack\.Screen name="\(contractor\)" \/>\s*<Stack\.Screen name="\(owner\)" \/>\s*<Stack\.Screen name="\(none\)" \/>\s*<\/Stack\.Protected>/,
    );
    expect(signedOut).toMatch(/<Stack\.Protected guard redirectTo="\/">\s*<Stack\.Screen name="\(auth\)" \/>/);
  });

  it("resolves / inside the auth group by redirecting to sign-in", () => {
    const index = join(mobileApp, "(auth)", "index.tsx");
    expect(existsSync(index)).toBe(true);
    const source = readFileSync(index, "utf8");
    expect(source).toContain('import { Redirect } from "expo-router";');
    expect(source).toContain('<Redirect href="/sign-in" />');
    expect(existsSync(join(mobileApp, "(auth)", "sign-in.tsx"))).toBe(true);
  });

  it("keeps the auth group closed to signed-in viewers", () => {
    const signedIn = navigatorSource("SignedInNavigator");
    expect(signedIn).toMatch(/<Stack\.Protected guard=\{false\}>\s*<Stack\.Screen name="\(auth\)" \/>/);
    expect(signedIn).toContain('<Stack.Protected guard={workspace === "owner"}>');
    expect(signedIn).toContain('<Stack.Protected guard={workspace === "contractor"}>');
    expect(signedIn).toContain('<Stack.Protected guard={workspace === "none"}>');
  });
});
