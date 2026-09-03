import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekStartInput, weekTotalsExpectationInput } from "@/lib/validation";
import { approveWeek } from "@/services/week-approval";

export async function POST(request: Request, context: { params: Promise<{ weekStart: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { weekStart } = await context.params;
  const parsed = weekStartInput.safeParse(weekStart);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  try {
    const expected = weekTotalsExpectationInput.parse(await readJson(request));
    return noStoreJson(await approveWeek(db, access.user.id, parsed.data, expected));
  } catch (error) {
    return apiError(error);
  }
}
