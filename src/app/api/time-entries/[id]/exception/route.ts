import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { occurrenceExceptionInput } from "@/lib/validation";
import { applyOccurrenceException } from "@/services/schedule";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const parsed = occurrenceExceptionInput.safeParse(await readJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await applyOccurrenceException(db, access.user.id, id, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "no_schedule") return noStoreJson({ error: "no_schedule" }, 409);
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    if (error instanceof Error && error.message === "duplicate_entry") return noStoreJson({ error: "duplicate_entry" }, 409);
    return await apiError(error, request);
  }
}
