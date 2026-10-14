import { noStoreJson } from "@/lib/accounts-config";
import { requireSessionUser, type SessionUser } from "@/lib/request-session";
import { getTrustedOrigins } from "@/lib/runtime-env";
import { isTrustedMutationRequest } from "@/lib/accounts-config";

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
  return request.json();
}

export function apiError(error: unknown): Response {
  if (error instanceof Error) {
    if (error.message === "payload_too_large") return noStoreJson({ error: "payload_too_large" }, 413);
    if (error.message === "not_found") return noStoreJson({ error: "not_found" }, 404);
    if (error.message === "business_required") return noStoreJson({ error: "business_required" }, 409);
    if (error.message === "duplicate_contractor") return noStoreJson({ error: "duplicate_contractor" }, 409);
  }
  return noStoreJson({ error: "invalid_request" }, 400);
}

export function readItemError(error: unknown): Response {
  if (error instanceof Error && error.message === "business_required") return noStoreJson({ error: "not_found" }, 404);
  return apiError(error);
}
