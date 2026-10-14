import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { assignmentRateInput } from "@/lib/validation";
import { getAssignment, unassignAssignment, updateAssignmentRate } from "@/services/timesheet";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await getAssignment(db, access.user.id, id));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    return await apiError(error, request);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const input = assignmentRateInput.parse(await readJson(request));
    return noStoreJson(await updateAssignmentRate(db, access.user.id, id, input));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    return await apiError(error, request);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const ok = await unassignAssignment(db, access.user.id, id);
    return ok ? noStoreJson({ ok: true }) : noStoreJson({ error: "not_found" }, 404);
  } catch (error) {
    return await apiError(error, request);
  }
}
