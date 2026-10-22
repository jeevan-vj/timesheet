import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { assertEmailConfigured, deliverInvite } from "@/lib/invite-delivery";
import { isValidContractorId } from "@/lib/contractor-lifecycle";
import { resendInvite } from "@/services/invites";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true); if ("response" in access) return access.response;
  const { id } = await params; if (!isValidContractorId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try { assertEmailConfigured(); const invite = await resendInvite(db, access.user.id, id); await deliverInvite(invite); return noStoreJson({ invite: { id: invite.id, contractorId: invite.contractorId, status: invite.status, expiresAt: invite.expiresAt } }); }
  catch (error) { return apiError(error, request); }
}
