import { db } from "@/db/client";
import { apiError, authorize } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { completeOnboarding } from "@/services/business";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await completeOnboarding(db, access.user.id));
  } catch (error) {
    return apiError(error);
  }
}
