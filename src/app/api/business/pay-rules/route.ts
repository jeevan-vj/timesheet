import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { activeOwnerMembership } from "@/lib/business";
import { payRulesInput } from "@/lib/validation";
import { getPayRules, putPayRules } from "@/services/pay-rules";

async function forbidNonOwner(userId: string): Promise<Response | null> {
  return await activeOwnerMembership(db, userId) ? null : noStoreJson({ error: "forbidden" }, 403);
}

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const forbidden = await forbidNonOwner(access.user.id);
  if (forbidden) return forbidden;
  try {
    return noStoreJson(await getPayRules(db, access.user.id));
  } catch (error) {
    return await apiError(error, request);
  }
}

export async function PUT(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const forbidden = await forbidNonOwner(access.user.id);
  if (forbidden) return forbidden;
  try {
    return noStoreJson(await putPayRules(db, access.user.id, payRulesInput.parse(await readJson(request))));
  } catch (error) {
    return await apiError(error, request);
  }
}
