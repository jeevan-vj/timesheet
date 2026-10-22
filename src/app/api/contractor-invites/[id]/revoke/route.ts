import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { isValidContractorId } from "@/lib/contractor-lifecycle";
import { revokeInvite } from "@/services/invites";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true); if ("response" in access) return access.response;
  const { id } = await params; if (!isValidContractorId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try { return noStoreJson({ invite: await revokeInvite(db, access.user.id, id) }); }
  catch (error) { return apiError(error, request); }
}
