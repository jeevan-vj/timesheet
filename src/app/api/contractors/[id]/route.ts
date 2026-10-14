import { db } from "@/db/client";
import { apiError, authorize, readItemError, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { isValidContractorId } from "@/lib/contractor-lifecycle";
import { contractorInput, invalidRequestFromZod } from "@/lib/validation";
import { getContractor, updateContractor } from "@/services/timesheet";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!isValidContractorId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    return noStoreJson(await getContractor(db, access.user.id, id));
  } catch (error) {
    return readItemError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!isValidContractorId(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const parsed = contractorInput.safeParse(await readJson(request));
    if (!parsed.success) return noStoreJson(invalidRequestFromZod(parsed.error), 400);
    return noStoreJson(await updateContractor(db, access.user.id, id, parsed.data));
  } catch (error) {
    return apiError(error);
  }
}
