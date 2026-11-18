import type { PortalShiftSubmission, PortalWeekSubmission } from "@cleantrack/core/portal";
import { onlineManager, useMutation, useQueryClient } from "@tanstack/react-query";
import { mobileFetch } from "@/api";
import {
  replacePortalShift,
  runContractorShiftStatus,
  type ContractorShiftAction,
  type ContractorShiftMutationError,
  type ContractorShiftMutationSend,
} from "@/contractor-shift";

export class ContractorShiftMutationFailure extends Error {
  readonly detail: ContractorShiftMutationError;

  constructor(detail: ContractorShiftMutationError) {
    super(detail.message);
    this.name = "ContractorShiftMutationFailure";
    this.detail = detail;
  }
}

const sendContractorShiftStatus: ContractorShiftMutationSend = async (path, init) => {
  const response = await mobileFetch(path, init);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
};

export function useContractorShiftStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (input: { entryId: string; action: ContractorShiftAction; paidMinutes?: number; reason?: string }) => {
      const result = await runContractorShiftStatus(
        input.entryId,
        input.action,
        { paidMinutes: input.paidMinutes, reason: input.reason },
        sendContractorShiftStatus,
        { online: onlineManager.isOnline() },
      );
      if (!result.ok) throw new ContractorShiftMutationFailure(result.error);
      return result.shift;
    },
    onSuccess: async (shift: PortalShiftSubmission) => {
      queryClient.setQueriesData<PortalWeekSubmission>({ queryKey: ["portal-week"] }, (current) => replacePortalShift(current, shift));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["portal-week"] }),
        queryClient.invalidateQueries({ queryKey: ["portal-upcoming"] }),
        queryClient.invalidateQueries({ queryKey: ["portal-payments"] }),
      ]);
    },
  });
}
