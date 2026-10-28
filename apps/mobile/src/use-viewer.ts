import { useCallback, useEffect, useState } from "react";
import { sessionEndsOnStatus, roleLabel, type ViewerRole } from "@/api-config";
import { mobileFetch } from "@/api";
import { readViewerProfile, type ContractorLink } from "@/me-response";

export type ViewerStatus = "loading" | "ready" | "error";

export function useViewer() {
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [role, setRole] = useState<ViewerRole>("none");
  const [contractorOf, setContractorOf] = useState<ContractorLink[]>([]);

  const reload = useCallback(async () => {
    setStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const response = await mobileFetch("/api/me");
      if (sessionEndsOnStatus(response.status)) return;
      const profile = response.ok ? readViewerProfile(await response.json()) : null;
      if (!profile) {
        setStatus("error");
        return;
      }
      setRole(profile.role);
      setContractorOf(profile.contractorOf);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { status, role, label: roleLabel(role), contractorOf, reload };
}
