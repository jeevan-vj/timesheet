import { db } from "@/db/client";
import { apiError, authorize, readItemError, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { timeEntryUpdateInput } from "@/lib/validation";
import { deleteTimeEntry, getTimeEntry, updateTimeEntry } from "@/services/timesheet";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const entry = await getTimeEntry(db, access.user.id, id);
    return entry ? noStoreJson(entry) : noStoreJson({ error: "not_found" }, 404);
  } catch (error) {
    return await readItemError(error, request);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const input = timeEntryUpdateInput.parse(await readJson(request));
    return noStoreJson(await updateTimeEntry(db, access.user.id, id, input));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "invalid_shift") return noStoreJson({ error: "invalid_shift" }, 400);
    if (error instanceof Error && error.message === "duplicate_entry") return noStoreJson({ error: "duplicate_entry" }, 409);
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    return await apiError(error, request);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const deleted = await deleteTimeEntry(db, access.user.id, id);
    return deleted ? noStoreJson({ ok: true }) : noStoreJson({ error: "not_found" }, 404);
  } catch (error) {
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    return await apiError(error, request);
  }
}
