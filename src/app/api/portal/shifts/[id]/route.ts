import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { contractorShiftStatusInput } from "@/lib/validation";
import { submitPortalShift } from "@/services/portal";

const SHIFT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  const { id } = await context.params;
  if (!SHIFT_ID.test(id)) return noStoreJson({ error: "invalid_request" }, 400);
  try {
    const parsed = contractorShiftStatusInput.safeParse(await readJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await submitPortalShift(db, access.user.id, id, parsed.data));
  } catch (error) {
    return apiError(error, request);
  }
}
