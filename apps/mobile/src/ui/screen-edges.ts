export type ScreenEdge = "top" | "right" | "bottom" | "left";

/** A visible navigation header already applies the top inset. */
export function screenSafeAreaEdges(headerShown: boolean): readonly ScreenEdge[] {
  if (headerShown) return ["right", "bottom", "left"];
  return ["top", "right", "bottom", "left"];
}
