import { createContext, useContext, type ReactNode } from "react";
import { useViewer } from "./use-viewer";

type Viewer = ReturnType<typeof useViewer>;

const ViewerContext = createContext<Viewer | null>(null);

export function ViewerProvider({ children }: { children: ReactNode }) {
  const viewer = useViewer();
  return <ViewerContext value={viewer}>{children}</ViewerContext>;
}

export function useCurrentViewer(): Viewer {
  const viewer = useContext(ViewerContext);
  if (!viewer) throw new Error("ViewerProvider is missing.");
  return viewer;
}
