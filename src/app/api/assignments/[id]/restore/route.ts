import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { restoreAssignment } from "@/services/timesheet";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await restoreAssignment(db, access.user.id, id));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    return await apiError(error, request);
  }
}
