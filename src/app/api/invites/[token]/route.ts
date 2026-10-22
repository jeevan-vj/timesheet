import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { acceptInvite, inspectInvite } from "@/services/invites";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try { const { token } = await params; return noStoreJson(await inspectInvite(db, token)); }
  catch (error) { return apiError(error, request); }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const access = await authorize(request, true); if ("response" in access) return access.response;
  try { const { token } = await params; await acceptInvite(db, token, access.user); return noStoreJson({ accepted: true }); }
  catch (error) { return apiError(error, request); }
}
