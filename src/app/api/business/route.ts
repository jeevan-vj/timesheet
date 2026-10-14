import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { businessInput } from "@/lib/validation";
import { createOwnerBusiness } from "@/services/business";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = businessInput.parse(await readJson(request));
    const result = await createOwnerBusiness(db, access.user.id, input);
    return noStoreJson(result.resource, result.created ? 201 : 200);
  } catch (error) {
    return apiError(error);
  }
}
