import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mobileFetch } from "./api";
import { OWNER_DASHBOARD_QUERY } from "./owner-api";
import {
  runOwnerWeekApproval,
  type OwnerWeekApprovalError,
  type OwnerWeekApprovalInput,
  type OwnerWeekApprovalSend,
} from "./week-approval";

export class OwnerWeekApprovalFailure extends Error {
  readonly detail: OwnerWeekApprovalError;

  constructor(detail: OwnerWeekApprovalError) {
    super(detail.message);
    this.name = "OwnerWeekApprovalFailure";
    this.detail = detail;
  }
}

const sendOwnerWeekApproval: OwnerWeekApprovalSend = async (path, init) => {
  const response = await mobileFetch(path, init);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
};

export function useOwnerWeekApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OwnerWeekApprovalInput) => {
      const result = await runOwnerWeekApproval(input, sendOwnerWeekApproval);
      if (!result.ok) throw new OwnerWeekApprovalFailure(result.error);
      return result.body;
    },
    retry: false,
    onSuccess: async (_body, input) => {
      await queryClient.invalidateQueries({ queryKey: [OWNER_DASHBOARD_QUERY, input.weekStart] });
    },
  });
}
