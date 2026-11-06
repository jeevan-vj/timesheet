import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { activeOwnerMembership } from "@/lib/business";
import { deleteBusinessHoliday } from "@/services/pay-rules";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  if (!await activeOwnerMembership(db, access.user.id)) return noStoreJson({ error: "forbidden" }, 403);
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
