import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { parseIncludeArchived } from "@/lib/contractor-lifecycle";
import { contractorInput, invalidRequestFromZod } from "@/lib/validation";
import { createContractor, listContractors } from "@/services/timesheet";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  const parsed = parseIncludeArchived(new URL(request.url).searchParams.get("includeArchived"));
  if (!parsed.ok) return noStoreJson({ error: "invalid_request" }, 400);
  return noStoreJson({ contractors: await listContractors(db, access.user.id, parsed.includeArchived) });
}

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const parsed = contractorInput.safeParse(await readJson(request));
    if (!parsed.success) return noStoreJson(invalidRequestFromZod(parsed.error), 400);
    return noStoreJson(await createContractor(db, access.user.id, parsed.data), 201);
  } catch (error) {
    return apiError(error);
  }
}
