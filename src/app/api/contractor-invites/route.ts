import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { listInvites } from "@/services/invites";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  try { return noStoreJson({ invites: await listInvites(db, access.user.id) }); }
  catch (error) { return apiError(error, request); }
}
