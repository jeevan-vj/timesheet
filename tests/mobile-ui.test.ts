import { describe, expect, it } from "vitest";
import { workspaceForRole } from "../apps/mobile/src/role-route";
import { statusColors, theme } from "../apps/mobile/src/theme";
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

describe("mobile workspace routing", () => {
  it("routes every viewer role without showing the wrong workspace", () => {
    expect(workspaceForRole("contractor")).toBe("contractor");
    expect(workspaceForRole("owner_and_contractor")).toBe("contractor");
    expect(workspaceForRole("owner")).toBe("owner");
    expect(workspaceForRole("none")).toBe("none");
  });
});

describe("mobile status pill tones", () => {
  it("maps shift and pay states to a labelled semantic tone", () => {
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
