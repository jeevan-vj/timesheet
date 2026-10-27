import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekStartInput } from "@/lib/validation";
import { getPortalPaymentDetail } from "@/services/portal";

export async function GET(request: Request, context: { params: Promise<{ week: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { week } = await context.params;
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  try {
    const detail = await getPortalPaymentDetail(db, access.user.id, parsed.data);
    if (!detail) return noStoreJson({ error: "not_found" }, 404);
    return noStoreJson(detail);
  } catch (error) {
    return apiError(error, request);
  }
}
