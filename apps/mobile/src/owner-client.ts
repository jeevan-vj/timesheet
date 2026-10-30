import {
  ownerContractorsSchema,
  ownerContractorSchema,
  ownerDashboardSchema,
  ownerInvitationSchema,
  ownerMeSchema,
  ownerSitesSchema,
  type OwnerContractor,
  type OwnerDashboard,
  type OwnerInvitation,
  type OwnerMe,
  type OwnerSite,
} from "@cleantrack/core";
import { useQuery } from "@tanstack/react-query";
import type { ZodType } from "zod";
import { mobileFetch } from "@/api";
import {
  OWNER_CONTRACTORS_QUERY,
  OWNER_CONTRACTOR_QUERY,
  OWNER_DASHBOARD_QUERY,
  OWNER_HTTP_METHOD,
  OWNER_INVITATION_QUERY,
  OWNER_ME_PATH,
  OWNER_ME_QUERY,
  OWNER_SITES_PATH,
  OWNER_SITES_QUERY,
  ownerContractorPath,
  ownerDashboardPath,
  ownerInvitationPath,
  ownerQueryRetry,
  readOwner,
  type OwnerLoadResult,
} from "@/owner-api";
import { ownerContractorsPath } from "@/owner-team";

async function loadOwner(path: string, method: typeof OWNER_HTTP_METHOD): Promise<OwnerLoadResult> {
  const response = await mobileFetch(path, { method });
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
}

function useOwnerRead<T>(queryKey: readonly unknown[], path: () => string, schema: ZodType<T>) {
  return useQuery({
    queryKey,
    retry: ownerQueryRetry,
    queryFn: () => readOwner(path(), schema, loadOwner),
  });
}

export function useOwnerDashboard(weekStart: string) {
  return useOwnerRead<OwnerDashboard>([OWNER_DASHBOARD_QUERY, weekStart], () => ownerDashboardPath(weekStart), ownerDashboardSchema);
}

export function useOwnerContractors(includeArchived = false) {
  return useOwnerRead<{ contractors: OwnerContractor[] }>(
    [OWNER_CONTRACTORS_QUERY, includeArchived ? "all" : "current"],
    () => ownerContractorsPath(includeArchived),
    ownerContractorsSchema,
  );
}

export function useOwnerContractor(id: string) {
  return useOwnerRead<OwnerContractor>([OWNER_CONTRACTOR_QUERY, id], () => ownerContractorPath(id), ownerContractorSchema);
}

export function useOwnerInvitation(id: string) {
  return useOwnerRead<OwnerInvitation>([OWNER_INVITATION_QUERY, id], () => ownerInvitationPath(id), ownerInvitationSchema);
}

export function useOwnerSites() {
  return useOwnerRead<OwnerSite[]>([OWNER_SITES_QUERY], () => OWNER_SITES_PATH, ownerSitesSchema);
}

export function useOwnerMe() {
  return useOwnerRead<OwnerMe>([OWNER_ME_QUERY], () => OWNER_ME_PATH, ownerMeSchema);
}
