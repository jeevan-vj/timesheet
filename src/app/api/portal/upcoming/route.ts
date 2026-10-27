import { aucklandDateIso, PORTAL_UPCOMING_DAYS } from "@cleantrack/core/portal";
import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { getPortalUpcoming } from "@/services/portal";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const raw = new URL(request.url).searchParams.get("days");
  let days = PORTAL_UPCOMING_DAYS;
  if (raw != null && raw !== "") {
    if (!/^\d{1,2}$/.test(raw)) return noStoreJson({ error: "invalid_request" }, 400);
    days = Number(raw);
    if (days < 1 || days > PORTAL_UPCOMING_DAYS) return noStoreJson({ error: "invalid_request" }, 400);
  }
  try {
    return noStoreJson(await getPortalUpcoming(db, access.user.id, days, aucklandDateIso(new Date())));
  } catch (error) {
    return apiError(error, request);
  }
}
