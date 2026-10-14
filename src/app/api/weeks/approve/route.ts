import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekApproveInput, weekStartInput } from "@/lib/validation";
import { approveWeek } from "@/services/week-approval";

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
    const parsed = weekApproveInput.safeParse(body);
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await approveWeek(db, access.user.id, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "stale_week") return noStoreJson({ error: "stale_week" }, 409);
    return await apiError(error, request);
  }
}
