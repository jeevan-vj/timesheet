import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekReopenInput } from "@/lib/validation";
import { reopenWeek } from "@/services/week-approval";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const parsed = weekReopenInput.safeParse(await readJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
    return noStoreJson(await reopenWeek(db, access.user.id, parsed.data));
  } catch (error) {
    if (error instanceof Error && error.message === "week_not_approved") return noStoreJson({ error: "week_not_approved" }, 409);
    return await apiError(error, request);
  }
}
