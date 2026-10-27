import { theme } from "./theme-tokens.mjs";

export { theme };

export type ThemeColor = keyof Pick<
  typeof theme,
  "background" | "surface" | "surfaceRaised" | "accent" | "accentText" | "text" | "muted" | "mutedHighContrast"
>;
