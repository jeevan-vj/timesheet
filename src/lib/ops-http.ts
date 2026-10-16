import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError } from "@/lib/api";
import { opsBearerAuthorized } from "@/lib/ops-auth";

const opsErrors: Record<string, { status: number; error: string }> = {
  payload_too_large: { status: 413, error: "payload_too_large" },
  invalid_request: { status: 400, error: "invalid_request" },
  invalid_sql: { status: 400, error: "invalid_sql" },
  forbidden_sql: { status: 400, error: "forbidden_sql" },
  confirm_required: { status: 400, error: "confirm_required" },
  confirm_expired: { status: 400, error: "confirm_expired" },
  confirm_mismatch: { status: 400, error: "confirm_mismatch" },
  confirm_used: { status: 409, error: "confirm_used" },
  stale_preview: { status: 409, error: "stale_preview" },
  not_revertable: { status: 409, error: "not_revertable" },
  already_reverted: { status: 409, error: "already_reverted" },
};

export function getOpsBotToken(): string {
  const raw = (env as { OPS_BOT_TOKEN?: string }).OPS_BOT_TOKEN;
  return typeof raw === "string" ? raw : "";
}

export function isOpsId(id: string): boolean {
  return id.length > 0 && id.length <= 64;
}

export async function requireOps(request: Request): Promise<Response | { token: string }> {
  const token = getOpsBotToken();
  if (!await opsBearerAuthorized(request.headers.get("authorization"), token)) {
    return noStoreJson({ error: "unauthorized" }, 401);
  }
  return { token };
}

export async function readOpsJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(contentLength) || contentLength <= 0 || contentLength > 16_384) throw new Error("payload_too_large");
  try {
    return await request.json();
  } catch {
    throw new Error("invalid_request");
  }
}

export async function opsError(error: unknown, request: Request): Promise<Response> {
  if (error instanceof Error && Object.hasOwn(opsErrors, error.message)) {
    const mapped = opsErrors[error.message];
    if (mapped) return noStoreJson({ error: mapped.error }, mapped.status);
  }
  return apiError(error, request);
}

export async function withOps(
  request: Request,
  handle: (auth: { token: string }) => Promise<Response>,
): Promise<Response> {
  const access = await requireOps(request);
  if (access instanceof Response) return access;
  try {
    return await handle(access);
  } catch (error) {
    return opsError(error, request);
  }
}
