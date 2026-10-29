import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mobileFetch } from "./api";
import { OWNER_DASHBOARD_QUERY } from "./owner-api";
import {
  OWNER_SHIFT_ACTIONS_ENABLED,
  OWNER_SHIFT_ACTIONS_DISABLED_MESSAGE,
  runOwnerShiftException,
  type OwnerShiftAction,
  type OwnerShiftMutationError,
  type OwnerShiftMutationSend,
} from "./owner-mutations";

export class OwnerShiftMutationFailure extends Error {
  readonly detail: OwnerShiftMutationError;

  constructor(detail: OwnerShiftMutationError) {
    super(detail.message);
    this.name = "OwnerShiftMutationFailure";
    this.detail = detail;
  }
}

const sendOwnerShiftException: OwnerShiftMutationSend = async (path, init) => {
  const response = await mobileFetch(path, init);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
};

export function useOwnerShiftException(onSettled?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; action: OwnerShiftAction; paidMinutes?: number }) => {
      if (!OWNER_SHIFT_ACTIONS_ENABLED) {
        throw new Error(OWNER_SHIFT_ACTIONS_DISABLED_MESSAGE);
      }
      const result = await runOwnerShiftException(input.entryId, input.action, input.paidMinutes, sendOwnerShiftException);
      if (!result.ok) throw new OwnerShiftMutationFailure(result.error);
      return result.body;
    },
    // Mutation-level cleanup survives closing/resetting the sheet observer.
    onSettled: () => { onSettled?.(); },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [OWNER_DASHBOARD_QUERY] });
    },
  });
}
