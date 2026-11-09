import { db } from "@/db/client";
import { apiError, readJson, requireActiveOwner } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { businessHolidayInput } from "@/lib/validation";
import { createBusinessHoliday, listBusinessHolidays } from "@/services/pay-rules";

export async function GET(request: Request) {
  const access = await requireActiveOwner(request);
  if ("response" in access) return access.response;
  try {
    return noStoreJson({ holidays: await listBusinessHolidays(db, access.user.id) });
  } catch (error) {
    return await apiError(error, request);
  }
}

export async function POST(request: Request) {
  const access = await requireActiveOwner(request, true);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await createBusinessHoliday(db, access.user.id, businessHolidayInput.parse(await readJson(request))), 201);
  } catch (error) {
    return await apiError(error, request);
  }
}
