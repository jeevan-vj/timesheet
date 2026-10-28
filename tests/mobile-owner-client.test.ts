import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { portalQueryPersists } from "@cleantrack/core/portal";
import { z } from "zod";
import {
  OWNER_HTTP_METHOD,
  OWNER_QUERY_ROOTS,
  OWNER_WEB_DASHBOARD_PATH,
  OwnerReadError,
  ownerContractorPath,
  ownerDashboardPath,
  ownerInvitationPath,
  ownerQueryRetry,
  ownerReadMessage,
  ownerReadRequest,
  readOwner,
} from "../apps/mobile/src/owner-api";

const ownerRoots = [
  "apps/mobile/src/owner-api.ts",
  "apps/mobile/src/owner-client.ts",
  "apps/mobile/src/components/owner-tabs.tsx",
  "apps/mobile/src/components/owner-tabs.web.tsx",
  "apps/mobile/src/components/owner-feedback.tsx",
  "apps/mobile/src/components/owner-week-picker.tsx",
  "apps/mobile/src/components/owner-shift-row.tsx",
  "apps/mobile/src/app/(owner)",
];

function filesIn(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) => filesIn(join(path, name)));
}

const okSchema = z.object({ ok: z.literal(true) }).strict();

describe("owner read client", () => {
  it("issues GET requests and refuses week mutations", async () => {
    let called = false;
    await expect(readOwner("/api/weeks/apply-schedule", okSchema, async () => {
      called = true;
      return { status: 200, body: { ok: true } };
    })).rejects.toMatchObject({ code: "unavailable" });
    expect(called).toBe(false);
    expect(() => ownerReadRequest("/api/weeks/approve")).toThrow(/unavailable/);
    expect(() => ownerReadRequest("/api/weeks/apply-schedule")).toThrow(/unavailable/);
  });

  it("calls the loader with GET and maps status, malformed JSON, and network failure", async () => {
    let method = "";
    const value = await readOwner("/api/dashboard?week=2026-10-26", okSchema, async (path, nextMethod) => {
      method = nextMethod;
      expect(path).toBe("/api/dashboard?week=2026-10-26");
      return { status: 200, body: { ok: true } };
    });
    expect(method).toBe("GET");
    expect(OWNER_HTTP_METHOD).toBe("GET");
    expect(value).toEqual({ ok: true });
    await expect(readOwner("/api/me", okSchema, async () => {
      throw new TypeError("network");
    })).rejects.toMatchObject({ code: "offline" });
    await expect(readOwner("/api/me", okSchema, async () => ({ status: 401, body: { error: "unauthorized" } }))).rejects.toMatchObject({ code: "unauthorized" });
    await expect(readOwner("/api/me", okSchema, async () => ({ status: 409, body: { error: "business_required" } }))).rejects.toMatchObject({ code: "business_required" });
    await expect(readOwner("/api/dashboard?week=2026-10-27", okSchema, async () => ({ status: 400, body: { error: "invalid_week" } }))).rejects.toMatchObject({ code: "invalid_week" });
    await expect(readOwner("/api/contractors", okSchema, async () => ({ status: 400, body: { error: "invalid_request" } }))).rejects.toMatchObject({ code: "unavailable" });
    await expect(readOwner("/api/contractors/missing", okSchema, async () => ({ status: 404, body: { error: "not_found" } }))).rejects.toMatchObject({ code: "not_found" });
    await expect(readOwner("/api/me", okSchema, async () => ({ status: 200, body: { ok: false } }))).rejects.toMatchObject({ code: "unavailable" });
  });

  it("builds only read paths", () => {
    expect(ownerDashboardPath("2026-10-26")).toBe("/api/dashboard?week=2026-10-26");
    expect(() => ownerDashboardPath("2026-10-27")).toThrow(/invalid_week/);
    expect(ownerContractorPath("contractor-1")).toBe("/api/contractors/contractor-1");
    expect(ownerInvitationPath("contractor-1")).toBe("/api/contractors/contractor-1/invitation");
    expect(() => ownerContractorPath("../contractor-1")).toThrow(/not_found/);
    expect(() => ownerInvitationPath("a/b")).toThrow(/not_found/);
    expect(OWNER_WEB_DASHBOARD_PATH).toBe("/dashboard");
  });

  it("retries only the first network or offline failure", () => {
    const offline = new OwnerReadError("offline");
    const network = new TypeError("network");
    expect(ownerQueryRetry(0, offline)).toBe(true);
    expect(ownerQueryRetry(0, network)).toBe(true);
    expect(ownerQueryRetry(1, offline)).toBe(false);
    expect(ownerQueryRetry(1, network)).toBe(false);
    expect(ownerQueryRetry(0, new OwnerReadError("unauthorized"))).toBe(false);
    expect(ownerQueryRetry(0, new OwnerReadError("not_found"))).toBe(false);
    expect(ownerQueryRetry(0, new OwnerReadError("invalid_week"))).toBe(false);
    expect(ownerQueryRetry(0, new OwnerReadError("business_required"))).toBe(false);
    expect(ownerQueryRetry(0, new OwnerReadError("unavailable"))).toBe(false);
  });

  it("describes invalid week, signed-out, offline, and finish-setup states", () => {
    expect(ownerReadMessage(new OwnerReadError("business_required"))).toMatchObject({
      title: "Finish setup on web",
      finishOnWeb: true,
    });
    expect(ownerReadMessage(new OwnerReadError("invalid_week")).title).toBe("That week is not a Monday.");
    expect(ownerReadMessage(new OwnerReadError("unauthorized")).title).toBe("Sign in again");
    expect(ownerReadMessage(new OwnerReadError("offline")).title).toBe("You're offline");
  });

  it("keeps owner query roots out of the persisted cache", () => {
    expect(OWNER_QUERY_ROOTS).toEqual([
      "owner-dashboard",
      "owner-contractors",
      "owner-contractor",
      "owner-invitation",
      "owner-sites",
      "owner-me",
    ]);
    for (const root of OWNER_QUERY_ROOTS) {
      expect(portalQueryPersists([root, "2026-10-26"])).toBe(false);
    }
    const client = readFileSync("apps/mobile/src/owner-client.ts", "utf8");
    for (const root of [
      "OWNER_DASHBOARD_QUERY",
      "OWNER_CONTRACTORS_QUERY",
      "OWNER_CONTRACTOR_QUERY",
      "OWNER_INVITATION_QUERY",
      "OWNER_SITES_QUERY",
      "OWNER_ME_QUERY",
    ]) {
      expect(client).toContain(root);
    }
    expect(client).toContain("method");
    expect(client).toContain("retry: ownerQueryRetry");
    expect(client).not.toMatch(/queryKey:\s*\[\s*["']/);
    expect(client).not.toMatch(/\bfetch\s*\(/);
  });

  it("does not call apply-schedule or another mutating verb from the owner screens", () => {
    const sources = ownerRoots.flatMap((path) => filesIn(path)).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"));
    expect(sources.length).toBeGreaterThan(8);
    const api = readFileSync("apps/mobile/src/owner-api.ts", "utf8");
    expect(api).toContain('path.includes("apply-schedule")');
    expect(api).toContain('path.includes("/api/weeks")');
    const banned = [/apply-schedule/, /applySchedule/, /\/api\/weeks/, /\/remittance/, /\b(?:POST|PATCH|PUT|DELETE)\b/, /\bfetch\s*\(/];
    for (const file of sources) {
      if (file.endsWith("owner-api.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const pattern of banned) {
        expect(source, file).not.toMatch(pattern);
      }
    }
    const model = readFileSync("packages/core/src/owner-read.ts", "utf8");
    expect(model).not.toContain("calculateEntryPayCents");
    expect(model).not.toContain("apply-schedule");
    expect(model).toContain("Scheduled shifts appear after the week is opened on the web");
    const week = readFileSync("apps/mobile/src/app/(owner)/(tabs)/week.tsx", "utf8");
    expect(week.match(/Paid hours/g)).toEqual(["Paid hours"]);
    const today = readFileSync("apps/mobile/src/app/(owner)/(tabs)/index.tsx", "utf8");
    expect(today).toContain("entries: shifts");
    expect(today).toContain("weekEntries: data.entries");
    expect(today).toContain("scheduleNote: ownerScheduleNote");
  });
});
