import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { siteInput } from "@/lib/validation";
import { createSite } from "@/services/timesheet";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = siteInput.parse(await readJson(request));
    return noStoreJson(await createSite(db, access.user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
