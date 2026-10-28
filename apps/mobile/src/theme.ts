import { theme } from "./theme-tokens.mjs";

export { theme };

export const statusColors = {
  success: "#9FE870",
  warning: "#FFD166",
  danger: "#FF8A80",
  info: "#82C7FF",
  neutral: theme.mutedHighContrast,
} as const;

export type ThemeColor = keyof Pick<
  typeof theme,
  "background" | "surface" | "surfaceRaised" | "accent" | "accentText" | "text" | "muted" | "mutedHighContrast"
>;
