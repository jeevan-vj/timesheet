import { useCallback, useEffect, useState } from "react";
import { sessionEndsOnStatus, roleLabel, type ViewerRole } from "@/api-config";
import { mobileFetch } from "@/api";
import { readViewerRole } from "@/me-response";

export type ViewerStatus = "loading" | "ready" | "error";

export function useViewer() {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [role, setRole] = useState<ViewerRole>("none");

  const reload = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await mobileFetch("/api/me");
      if (sessionEndsOnStatus(response.status)) return;
      const next = response.ok ? readViewerRole(await response.json()) : null;
      if (!next) {
        setStatus("error");
        return;
      }
      setRole(next);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, role, label: roleLabel(role), reload };
}
