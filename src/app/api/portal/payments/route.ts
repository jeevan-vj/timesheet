import { aucklandDateIso } from "@cleantrack/core/portal";
import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekStartFromDate } from "@/lib/payroll";
import { weekStartInput } from "@/lib/validation";
import { getPortalPayments } from "@/services/portal";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const raw = new URL(request.url).searchParams.get("week");
  const week = raw == null || raw === "" ? weekStartFromDate(aucklandDateIso(new Date())) : raw;
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  try {
    return noStoreJson(await getPortalPayments(db, access.user.id, parsed.data));
  } catch (error) {
    return apiError(error, request);
  }
}
