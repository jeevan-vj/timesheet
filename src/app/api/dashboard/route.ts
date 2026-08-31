import { authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { weekStartInput } from "@/lib/validation";
import { getDashboard } from "@/services/timesheet";
import { db } from "@/db/client";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const week = new URL(request.url).searchParams.get("week") ?? "";
  const parsed = weekStartInput.safeParse(week);
  if (!parsed.success) return noStoreJson({ error: "invalid_week" }, 400);
  return noStoreJson(await getDashboard(db, access.user.id, parsed.data));
}
