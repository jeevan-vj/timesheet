import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekApplyScheduleInput, weekStartInput } from "@/lib/validation";
import { applyScheduleToWeek } from "@/services/schedule";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const body = await readJson(request);
    const week = weekStartInput.safeParse(
      body && typeof body === "object" && body !== null && "weekStart" in body
        ? (body as { weekStart: unknown }).weekStart
        : undefined,
    );
    if (!week.success) return noStoreJson({ error: "invalid_week" }, 400);
    const parsed = weekApplyScheduleInput.safeParse(body);
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await applyScheduleToWeek(db, access.user.id, parsed.data.weekStart));
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "week_locked") return noStoreJson({ error: "week_locked" }, 409);
    if (error instanceof Error && error.message === "duplicate_entry") return noStoreJson({ error: "duplicate_entry" }, 409);
    return await apiError(error, request);
  }
}
