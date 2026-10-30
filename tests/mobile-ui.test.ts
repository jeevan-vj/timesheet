import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shiftStatusLabel } from "@cleantrack/core/portal";
import {
  contractorWorkspaceLabel,
  nextWorkspace,
  workspaceForRole,
  workspaceSwitchAvailable,
} from "../apps/mobile/src/role-route";
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
    expect(workspaceForRole("owner_and_contractor")).toBe("owner");
    expect(workspaceForRole("owner_and_contractor", "contractor")).toBe("contractor");
    expect(workspaceForRole("owner_and_contractor", "owner")).toBe("owner");
    expect(workspaceForRole("owner")).toBe("owner");
    expect(workspaceForRole("none")).toBe("none");
  });

  it("ignores stale choices and only offers switching to dual-role users", () => {
    expect([
      workspaceForRole("owner", null),
      workspaceForRole("owner", "owner"),
      workspaceForRole("owner", "contractor"),
    ]).toEqual(["owner", "owner", "owner"]);
    expect([
      workspaceForRole("contractor", null),
      workspaceForRole("contractor", "owner"),
      workspaceForRole("contractor", "contractor"),
    ]).toEqual(["contractor", "contractor", "contractor"]);
    expect([
      workspaceForRole("none", null),
      workspaceForRole("none", "owner"),
      workspaceForRole("none", "contractor"),
    ]).toEqual(["none", "none", "none"]);
    expect(workspaceSwitchAvailable("owner_and_contractor")).toBe(true);
    expect(workspaceSwitchAvailable("owner")).toBe(false);
    expect(workspaceSwitchAvailable("contractor")).toBe(false);
    expect(nextWorkspace("owner")).toBe("contractor");
    expect(nextWorkspace("contractor")).toBe("owner");
  });

  it("names contractor workspaces with the linked businesses", () => {
    expect(contractorWorkspaceLabel([])).toBe("My work");
    expect(contractorWorkspaceLabel([{ businessId: "b1", businessName: "Northwind" }])).toBe("My work at Northwind");
    expect(contractorWorkspaceLabel([
      { businessId: "b1", businessName: "Northwind" },
      { businessId: "b2", businessName: "Harbour" },
    ])).toBe("My work at Northwind and Harbour");
  });

  it("serves owner tabs and the no-workspace home from index routes so / is not unmatched", () => {
    expect(existsSync(join(mobileApp, "(owner)", "(tabs)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(owner)", "(tabs)", "_layout.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(owner)", "index.tsx"))).toBe(false);
    expect(existsSync(join(mobileApp, "(none)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(contractor)", "(tabs)", "index.tsx"))).toBe(true);
    expect(existsSync(join(mobileApp, "(owner)", "owner.tsx"))).toBe(false);
    expect(existsSync(join(mobileApp, "(none)", "no-workspace.tsx"))).toBe(false);
  });

  it("offers the dual-role switch from both homes and account screens", () => {
    for (const file of [
      "(owner)/(tabs)/index.tsx",
      "(contractor)/(tabs)/index.tsx",
    ]) {
      expect(readFileSync(join(mobileApp, file), "utf8")).toContain("WorkspaceSwitchButton");
    }
    for (const file of [
      "(owner)/(tabs)/account.tsx",
      "(contractor)/(tabs)/account.tsx",
    ]) {
      expect(readFileSync(join(mobileApp, file), "utf8")).toContain("WorkspaceSwitchSection");
    }
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
    expect(statusPillTone("Open")).toBe("warning");
    expect(statusPillTone("Reopened")).toBe("warning");
    expect(statusPillTone("Active")).toBe("success");
    expect(statusPillTone("Invitation pending")).toBe("warning");
    expect(statusPillTone("Invitation expired")).toBe("danger");
    expect(statusPillTone("Archived")).toBe("neutral");
  });

  it("keeps every status label above AA contrast on cards", () => {
    for (const color of Object.values(statusColors)) {
      expect(contrast(color, theme.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
