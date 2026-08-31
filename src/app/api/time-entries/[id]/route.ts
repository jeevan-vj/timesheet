import { db } from "@/db/client";
import { authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { deleteTimeEntry } from "@/services/timesheet";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  const deleted = await deleteTimeEntry(db, access.user.id, id);
  return deleted ? noStoreJson({ ok: true }) : noStoreJson({ error: "not_found" }, 404);
}
