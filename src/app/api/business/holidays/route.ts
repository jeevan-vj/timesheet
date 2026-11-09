import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { activeOwnerMembership } from "@/lib/business";
import { businessHolidayInput } from "@/lib/validation";
import { createBusinessHoliday, listBusinessHolidays } from "@/services/pay-rules";

async function forbidNonOwner(userId: string): Promise<Response | null> {
  return await activeOwnerMembership(db, userId) ? null : noStoreJson({ error: "forbidden" }, 403);
}

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const forbidden = await forbidNonOwner(access.user.id);
  if (forbidden) return forbidden;
  try {
    return noStoreJson({ holidays: await listBusinessHolidays(db, access.user.id) });
  } catch (error) {
    return await apiError(error, request);
  }
}

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const forbidden = await forbidNonOwner(access.user.id);
  if (forbidden) return forbidden;
  try {
    return noStoreJson(await createBusinessHoliday(db, access.user.id, businessHolidayInput.parse(await readJson(request))), 201);
  } catch (error) {
    return await apiError(error, request);
  }
}
