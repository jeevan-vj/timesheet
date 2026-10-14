import { noStoreJson } from "@/lib/accounts-config";
import { requireSessionUser, type SessionUser } from "@/lib/request-session";
import { getTrustedOrigins } from "@/lib/runtime-env";
import { isTrustedMutationRequest } from "@/lib/accounts-config";
import { reportServerError } from "@/lib/report-server-error";
import { ZodError } from "zod";

const expectedErrors: Record<string, { status: number; error: string }> = {
  payload_too_large: { status: 413, error: "payload_too_large" },
  not_found: { status: 404, error: "not_found" },
  invalid_request: { status: 400, error: "invalid_request" },
  invalid_shift: { status: 400, error: "invalid_shift" },
  invalid_week: { status: 400, error: "invalid_request" },
  no_entries: { status: 400, error: "no_entries" },
  missing_remitter: { status: 400, error: "missing_remitter" },
  duplicate_contractor: { status: 409, error: "duplicate_contractor" },
  duplicate_site: { status: 409, error: "duplicate_site" },
  duplicate_assignment: { status: 409, error: "duplicate_assignment" },
  duplicate_entry: { status: 409, error: "duplicate_entry" },
  week_locked: { status: 409, error: "week_locked" },
  stale_week: { status: 409, error: "stale_week" },
  week_not_approved: { status: 409, error: "week_not_approved" },
  schedule_exists: { status: 409, error: "schedule_exists" },
  no_schedule: { status: 409, error: "no_schedule" },
};

export async function authorize(request: Request, mutation = false): Promise<{ user: SessionUser } | { response: Response }> {
  if (mutation && !isTrustedMutationRequest(request, getTrustedOrigins())) {
    return { response: noStoreJson({ error: "forbidden" }, 403) };
  }
  const user = await requireSessionUser(request);
  if (!user) return { response: noStoreJson({ error: "unauthorized" }, 401) };
  return { user };
}

export async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 16_384) throw new Error("payload_too_large");
  try {
    return await request.json();
  } catch {
    throw new Error("invalid_request");
  }
}

export async function apiError(error: unknown, request: Request): Promise<Response> {
  if (error instanceof ZodError) return noStoreJson({ error: "invalid_request" }, 400);
  if (error instanceof Error && Object.hasOwn(expectedErrors, error.message)) {
    const mapped = expectedErrors[error.message];
    if (mapped) return noStoreJson({ error: mapped.error }, mapped.status);
  }
  const correlationId = crypto.randomUUID();
  try {
    await reportServerError(error, request, correlationId);
  } catch {
    // Reporting must not change the client response.
  }
  return noStoreJson({ error: "internal_error", correlationId }, 500);
}
