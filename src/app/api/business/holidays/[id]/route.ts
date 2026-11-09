import { db } from "@/db/client";
import { apiError, requireActiveOwner } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { deleteBusinessHoliday } from "@/services/pay-rules";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireActiveOwner(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return await deleteBusinessHoliday(db, access.user.id, id)
      ? noStoreJson({ ok: true })
      : noStoreJson({ error: "not_found" }, 404);
  } catch (error) {
    return await apiError(error, request);
  }
}
