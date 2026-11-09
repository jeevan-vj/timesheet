import { db } from "@/db/client";
import { apiError, readJson, requireActiveOwner } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { payRulesInput } from "@/lib/validation";
import { getPayRules, putPayRules } from "@/services/pay-rules";

export async function GET(request: Request) {
  const access = await requireActiveOwner(request);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await getPayRules(db, access.user.id));
  } catch (error) {
    return await apiError(error, request);
  }
}

export async function PUT(request: Request) {
  const access = await requireActiveOwner(request, true);
  if ("response" in access) return access.response;
  try {
    return noStoreJson(await putPayRules(db, access.user.id, payRulesInput.parse(await readJson(request))));
  } catch (error) {
    return await apiError(error, request);
  }
}
