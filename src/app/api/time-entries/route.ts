import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { timeEntryInput } from "@/lib/validation";
import { createTimeEntry } from "@/services/timesheet";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = timeEntryInput.parse(await readJson(request));
    return noStoreJson(await createTimeEntry(db, access.user.id, input), 201);
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "invalid_shift") return noStoreJson({ error: "invalid_shift" }, 400);
    return apiError(error);
  }
}
