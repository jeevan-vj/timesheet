import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { scheduleDeleteInput, schedulePutInput, weekStartInput } from "@/lib/validation";
import { deleteAssignmentSchedule, getAssignmentSchedule, putAssignmentSchedule } from "@/services/schedule";

function weekStartFromBody(body: unknown) {
  return body && typeof body === "object" && body !== null && "weekStart" in body
    ? (body as { weekStart: unknown }).weekStart
    : undefined;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await getAssignmentSchedule(db, access.user.id, id));
  } catch (error) {
    if (error instanceof Error && (error.message === "not_found" || error.message === "business_required")) {
      return noStoreJson({ error: "not_found" }, 404);
    }
    return apiError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const body = await readJson(request);
    const week = weekStartInput.safeParse(weekStartFromBody(body));
    if (!week.success) return noStoreJson({ error: "invalid_week" }, 400);
    const parsed = schedulePutInput.safeParse(body);
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await putAssignmentSchedule(db, access.user.id, id, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "schedule_exists") return noStoreJson({ error: "schedule_exists" }, 409);
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    if (error instanceof Error && error.message === "no_schedule") return noStoreJson({ error: "no_schedule" }, 409);
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!id || id.length > 64) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const body = await readJson(request);
    const week = weekStartInput.safeParse(weekStartFromBody(body));
    if (!week.success) return noStoreJson({ error: "invalid_week" }, 400);
    const parsed = scheduleDeleteInput.safeParse(body);
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await deleteAssignmentSchedule(db, access.user.id, id, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "schedule_exists") return noStoreJson({ error: "schedule_exists" }, 409);
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    if (error instanceof Error && error.message === "no_schedule") return noStoreJson({ error: "no_schedule" }, 409);
    return apiError(error);
  }
}
