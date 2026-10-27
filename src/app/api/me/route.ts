import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { resolveViewer } from "@/lib/viewer";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await resolveViewer(db, access.user.id));
  } catch (error) {
    return apiError(error, request);
  }
}
