"use client";

import { useEffect, useState } from "react";
import { asViewerShape, landingPath, type ViewerShape } from "@/lib/viewer-path";

export function LoadWhenViewerReady({ ready, load }: { ready: boolean; load: () => Promise<void> }) {
  useEffect(() => {
    if (ready) void load();
  }, [load, ready]);
  return null;
}

export function useViewerGate(): { ready: boolean; viewer: ViewerShape | null } {
  const [viewer, setViewer] = useState<ViewerShape | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadViewer().then((result) => {
      if (cancelled || result === "redirect") return;
      setViewer(result);
    });
    return () => { cancelled = true; };
  }, []);
  return { ready: viewer !== null, viewer };
}

async function loadViewer(): Promise<ViewerShape | "redirect"> {
  try {
    const response = await fetch("/api/me", { cache: "no-store" });
    if (response.status === 401) {
      window.location.assign("/sign-in");
      return "redirect";
    }
    if (!response.ok) return { owner: null, contractorOf: [] };
    const viewer = asViewerShape(await response.json());
    if (landingPath(viewer) === "/portal") {
      window.location.assign("/portal");
      return "redirect";
    }
    return viewer;
  } catch {
    return { owner: null, contractorOf: [] };
  }
}
