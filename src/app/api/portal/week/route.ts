import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekStartInput } from "@/lib/validation";
import { getPortalWeek } from "@/services/portal";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const url = new URL(request.url);
  const parsed = weekStartInput.safeParse(url.searchParams.get("week") ?? "");
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  const submission = url.searchParams.get("submission") === "1";
  try {
    return noStoreJson(submission
      ? await getPortalWeek(db, access.user.id, parsed.data, { submission: true })
      : await getPortalWeek(db, access.user.id, parsed.data));
  } catch (error) {
    return apiError(error, request);
  }
}
