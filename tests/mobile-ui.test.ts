import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shiftStatusLabel } from "@cleantrack/core/portal";
import { workspaceForRole } from "../apps/mobile/src/role-route";
import { statusColors, theme } from "../apps/mobile/src/theme";
import { screenSafeAreaEdges } from "../apps/mobile/src/ui/screen-edges";
import { statusPillTone } from "../apps/mobile/src/ui/status-tone";

function channel(hex: string, shift: number): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const raw = ((value >> shift) & 255) / 255;
  return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const mobileApp = join(process.cwd(), "apps/mobile/src/app");

describe("mobile workspace routing", () => {
  it("routes every viewer role without showing the wrong workspace", () => {
    expect(workspaceForRole("contractor")).toBe("contractor");
    expect(workspaceForRole("owner_and_contractor")).toBe("contractor");
    expect(workspaceForRole("owner")).toBe("owner");
    expect(workspaceForRole("none")).toBe("none");
  });

  it("serves owner and no-workspace homes from index routes so / is not unmatched", () => {
    expect(existsSync(join(mobileApp, "(owner)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(none)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(contractor)", "(tabs)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(owner)", "owner.tsx"))).toBe(false);
    expect(existsSync(join(mobileApp, "(none)", "no-workspace.tsx"))).toBe(false);
  });
});

describe("mobile screen safe area", () => {
  it("pads the top inset only when no navigation header is showing", () => {
    expect(screenSafeAreaEdges(false)).toEqual(["top", "right", "bottom", "left"]);
    expect(screenSafeAreaEdges(true)).toEqual(["right", "bottom", "left"]);
  });
});

describe("mobile status pill tones", () => {
  it("maps shift and pay states to a labelled semantic tone", () => {
    expect(statusPillTone(shiftStatusLabel("scheduled"))).toBe("warning");
    expect(statusPillTone(shiftStatusLabel("worked"))).toBe("success");
    expect(statusPillTone(shiftStatusLabel("absent"))).toBe("neutral");
    expect(statusPillTone(shiftStatusLabel("hours_override"))).toBe("info");
    expect(statusPillTone(shiftStatusLabel("manual"))).toBe("info");
    expect(statusPillTone("Pending")).toBe("warning");
    expect(statusPillTone("Worked")).toBe("success");
    expect(statusPillTone("Didn't work")).toBe("neutral");
    expect(statusPillTone("Changed hours")).toBe("info");
    expect(statusPillTone("Recorded")).toBe("info");
    expect(statusPillTone("Approved")).toBe("success");
    expect(statusPillTone("Estimated")).toBe("warning");
  });

  it("keeps every status label above AA contrast on cards", () => {
    for (const color of Object.values(statusColors)) {
      expect(contrast(color, theme.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
