import { describe, expect, it } from "vitest";
import { theme } from "../apps/mobile/src/theme";
import { applicationId, applicationName, appVariant } from "../apps/mobile/src/variant";

function channel(hex: string, shift: number): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const raw = ((value >> shift) & 255) / 255;
  if (raw <= 0.03928) return raw / 12.92;
  return ((raw + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 16) + 0.7152 * channel(hex, 8) + 0.0722 * channel(hex, 0);
}

function contrast(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("mobile foundation", () => {
  it("uses dev and preview application ids beside production", () => {
    expect(appVariant(undefined)).toBe("development");
    expect(appVariant("development")).toBe("development");
    expect(applicationId("development")).toBe("nz.co.jnok.cleantrack.dev");
    expect(applicationId("preview")).toBe("nz.co.jnok.cleantrack.preview");
    expect(applicationId("production")).toBe("nz.co.jnok.cleantrack");
    expect(applicationName("production")).toBe("CleanTrack");
    expect(applicationName("preview")).toBe("CleanTrack (Preview)");
  });

  it("keeps muted text and lime accent above the dark-surface contrast floor", () => {
    expect(luminance(theme.muted)).toBeGreaterThanOrEqual(luminance("#A0A0A0"));
    expect(contrast(theme.muted, theme.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent, theme.background)).toBeGreaterThanOrEqual(7);
    expect(contrast(theme.accentText, theme.accent)).toBeGreaterThanOrEqual(7);
  });
});