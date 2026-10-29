import { useCallback, useEffect, useState } from "react";
import { sessionEndsOnStatus, roleLabel, type ViewerRole } from "@/api-config";
import { mobileFetch } from "@/api";
import { readViewerProfile, type ContractorLink } from "@/me-response";
import {
  workspaceForRole,
  workspaceSwitchAvailable,
  type WorkspaceChoice,
} from "@/role-route";
import { readWorkspaceChoice, writeWorkspaceChoice } from "@/workspace-choice";

export type ViewerStatus = "loading" | "ready" | "error";

export function useViewer() {
  const [profileStatus, setProfileStatus] = useState<ViewerStatus>("loading");
  const [role, setRole] = useState<ViewerRole>("none");
  const [contractorOf, setContractorOf] = useState<ContractorLink[]>([]);
  const [storedChoice, setStoredChoice] = useState<WorkspaceChoice | null | undefined>(undefined);

  const reload = useCallback(async () => {
    setProfileStatus((current) => (current === "ready" ? current : "loading"));
    try {
      const response = await mobileFetch("/api/me");
      if (sessionEndsOnStatus(response.status)) return;
      const profile = response.ok ? readViewerProfile(await response.json()) : null;
      if (!profile) {
        setProfileStatus("error");
        return;
      }
      setRole(profile.role);
      setContractorOf(profile.contractorOf);
      setProfileStatus("ready");
    } catch {
      setProfileStatus("error");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void readWorkspaceChoice()
      .then(setStoredChoice)
      .catch(() => setStoredChoice(null));
  }, []);

  const selectWorkspace = useCallback(async (choice: WorkspaceChoice) => {
    if (!workspaceSwitchAvailable(role)) return;
    await writeWorkspaceChoice(choice);
    setStoredChoice(choice);
  }, [role]);

  const status = storedChoice === undefined ? "loading" : profileStatus;
  return {
    status,
    role,
    label: roleLabel(role),
    contractorOf,
    workspace: workspaceForRole(role, storedChoice ?? null),
    canSwitchWorkspace: workspaceSwitchAvailable(role),
    selectWorkspace,
    reload,
  };
}
