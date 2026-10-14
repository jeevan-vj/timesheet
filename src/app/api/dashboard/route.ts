import { authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { summarizeWeek, weekEnd } from "@/lib/payroll";
import { weekStartInput } from "@/lib/validation";
import { businessResourceForUser } from "@/services/business";
import { getDashboard } from "@/services/timesheet";
import { toDashboardApproval } from "@/services/week-approval";
import { db } from "@/db/client";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const week = new URL(request.url).searchParams.get("week") ?? "";
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  try {
    const payload = await getDashboard(db, access.user.id, parsed.data);
    const business = await businessResourceForUser(db, access.user.id);
    if (!business) throw new Error("business_required");
    return noStoreJson({ ...payload, business });
  } catch (error) {
    if (error instanceof Error && error.message === "business_required") {
      return noStoreJson({
        weekStart: parsed.data,
        weekEnd: weekEnd(parsed.data),
        sites: [],
        contractors: [],
        assignments: [],
        entries: [],
        summary: summarizeWeek([]),
        approval: toDashboardApproval(null),
        business: null,
      });
    }
    throw error;
  }
}
