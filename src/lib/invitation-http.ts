import { noStoreJson } from "@/lib/accounts-config";
import { apiError, authorize } from "@/lib/api";
import { isValidContractorId } from "@/lib/contractor-lifecycle";
import { InvitationExistsError } from "@/lib/invitation-errors";

type OwnerAccess = { userId: string; contractorId: string } | { response: Response };

export async function withContractorOwner(
  request: Request,
  params: Promise<{ id: string }>,
  mutation: boolean,
): Promise<OwnerAccess> {
  const access = await authorize(request, mutation);
  if ("response" in access) return { response: access.response };
  const { id } = await params;
  if (!isValidContractorId(id)) return { response: noStoreJson({ error: "invalid_request" }, 400) };
  return { userId: access.user.id, contractorId: id };
}

export async function invitationResponse(error: unknown, request: Request): Promise<Response> {
  if (error instanceof InvitationExistsError) {
    return noStoreJson({ error: "invitation_exists", invitation: error.view }, 409);
  }
  return apiError(error, request);
}

export async function runInvitation(
  request: Request,
  params: Promise<{ id: string }>,
  mutation: boolean,
  action: (userId: string, contractorId: string) => Promise<unknown>,
  status = 200,
): Promise<Response> {
  const access = await withContractorOwner(request, params, mutation);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await action(access.userId, access.contractorId), status);
  } catch (error) {
    if (!mutation && error instanceof Error && error.message === "business_required") {
      return noStoreJson({ error: "not_found" }, 404);
    }
    return invitationResponse(error, request);
  }
}
