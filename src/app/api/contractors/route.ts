import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { contractorInput } from "@/lib/validation";
import { createContractor } from "@/services/timesheet";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = contractorInput.parse(await readJson(request));
    return noStoreJson(await createContractor(db, access.user.id, input), 201);
  } catch (error) {
    return apiError(error);
  }
}
