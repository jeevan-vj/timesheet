import { db } from "@/db/client";
import { apiError, authorize, readJson } from "@/lib/api";
import { noStoreJson } from "@/lib/accounts-config";
import { assignmentInput } from "@/lib/validation";
import { createAssignment, listAssignments } from "@/services/timesheet";

export async function GET(request: Request) {
  const access = await authorize(request);
  if ("response" in access) return access.response;
  return noStoreJson({ assignments: await listAssignments(db, access.user.id) });
}

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = assignmentInput.parse(await readJson(request));
    const result = await createAssignment(db, access.user.id, input);
    return noStoreJson(result.assignment, result.created ? 201 : 200);
  } catch (error) {
    if (error instanceof Error && error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error instanceof Error && error.message === "duplicate_assignment") return noStoreJson({ error: "duplicate_assignment" }, 409);
    return apiError(error);
  }
}
