import { useMutation, useQueryClient } from "@tanstack/react-query";
import { mobileFetch } from "./api";
import {
  OWNER_CONTRACTORS_QUERY,
  OWNER_CONTRACTOR_QUERY,
  OWNER_DASHBOARD_QUERY,
  OWNER_INVITATION_QUERY,
} from "./owner-api";
import {
  runOwnerShiftException,
  type OwnerShiftAction,
  type OwnerShiftMutationError,
  type OwnerShiftMutationSend,
} from "./owner-mutations";
import {
  runOwnerTeamMutation,
  type OwnerTeamAction,
  type OwnerTeamMutationBody,
  type OwnerTeamMutationError,
  type OwnerTeamMutationSend,
} from "./owner-team";

export class OwnerShiftMutationFailure extends Error {
  readonly detail: OwnerShiftMutationError;

  constructor(detail: OwnerShiftMutationError) {
    super(detail.message);
    this.name = "OwnerShiftMutationFailure";
    this.detail = detail;
  }
}

export class OwnerTeamMutationFailure extends Error {
  readonly detail: OwnerTeamMutationError;

  constructor(detail: OwnerTeamMutationError) {
    super(detail.message);
    this.name = "OwnerTeamMutationFailure";
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

const sendOwnerTeamMutation: OwnerTeamMutationSend = async (path, init) => {
  const response = await mobileFetch(path, init);
  try {
    return { status: response.status, body: await response.json() };
  } catch {
    return { status: response.status, body: null };
  }
};

function actionContractorId(action: OwnerTeamAction, body: OwnerTeamMutationBody): string | null {
  if (action.kind !== "create") return action.contractorId;
  return "contractor" in body ? body.contractor.id : null;
}

export function useOwnerTeamMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn: async (action: OwnerTeamAction) => {
      const result = await runOwnerTeamMutation(action, sendOwnerTeamMutation);
      if (!result.ok) throw new OwnerTeamMutationFailure(result.error);
      return { action, body: result.body };
    },
    onSuccess: async ({ action, body }) => {
      const contractorId = actionContractorId(action, body);
      const invalidations: Promise<unknown>[] = [
        queryClient.invalidateQueries({ queryKey: [OWNER_CONTRACTORS_QUERY] }),
      ];
      if (contractorId) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: [OWNER_CONTRACTOR_QUERY, contractorId] }));
        if (action.kind === "invite" || action.kind === "resend" || action.kind === "revoke") {
          invalidations.push(queryClient.invalidateQueries({ queryKey: [OWNER_INVITATION_QUERY, contractorId] }));
        }
      }
      await Promise.all(invalidations);
    },
  });
}

export function useOwnerShiftException(onSettled?: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { entryId: string; action: OwnerShiftAction; paidMinutes?: number }) => {
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
