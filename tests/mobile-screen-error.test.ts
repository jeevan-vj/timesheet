import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportScreenError } from "../apps/mobile/src/report-screen-error";
import { screenErrorCause } from "../apps/mobile/src/screen-error-cause";

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".expo") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) files.push(full);
  }
  return files;
}

describe("mobile screen error", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the boundary error from the one mobile console call", () => {
    const error = new Error("invalid_request");
    error.name = "RangeError";
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    reportScreenError(error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(error);
    const hits = walk("apps/mobile").filter((file) => /\bconsole\.(log|info|debug|warn|error)\s*\(/.test(readFileSync(file, "utf8")));
    expect(hits).toEqual(["apps/mobile/src/report-screen-error.ts"]);
  });

  it("shows the error name and message under the existing screen copy", () => {
    expect(screenErrorCause({ name: "RangeError", message: "invalid_request" })).toBe("RangeError: invalid_request");
    expect(screenErrorCause({ name: "Error", message: "   " })).toBe("Error");
    expect(screenErrorCause(undefined)).toBe("Error");
    const screen = readFileSync("apps/mobile/src/components/screen-error.tsx", "utf8");
    expect(screen).toContain("Something went wrong");
    expect(screen).toContain("This screen could not be shown. Try again.");
    expect(screen).toContain("screenErrorCause(error)");
    expect(screen).toContain('accessibilityLabel="Try again"');
    const root = readFileSync("apps/mobile/src/app/_layout.tsx", "utf8");
    const nested = readFileSync("apps/mobile/src/components/route-error-boundary.tsx", "utf8");
    expect(root).toContain("export function ErrorBoundary({ error, retry }: ErrorBoundaryProps)");
    expect(root).toContain("<RouteErrorBoundary error={error} retry={retry} />");
    for (const source of [root, nested]) {
      expect(source).toMatch(/useEffect\(\(\) => \{\s*reportScreenError\(error\);\s*\}, \[error\]\);/);
      expect(source.match(/reportScreenError\(error\)/g)).toEqual(["reportScreenError(error)"]);
    }
    for (const file of [
      "apps/mobile/src/app/(contractor)/_layout.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/_layout.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("export { ErrorBoundary }");
      expect(source, file).toContain("screenErrorBoundary: ErrorBoundary");
    }
    for (const file of [
      "apps/mobile/src/app/(contractor)/(tabs)/index.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/pay.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/week.tsx",
      "apps/mobile/src/app/(contractor)/(tabs)/account.tsx",
      "apps/mobile/src/app/(contractor)/upcoming.tsx",
    ]) {
      expect(readFileSync(file, "utf8"), file).toContain('export { ErrorBoundary } from "@/components/route-error-boundary"');
    }
  });
});
