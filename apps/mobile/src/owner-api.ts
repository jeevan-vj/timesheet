import { isMonday } from "@cleantrack/core/payroll";
import type { ZodType } from "zod";

export const OWNER_HTTP_METHOD = "GET" as const;

export const OWNER_DASHBOARD_QUERY = "owner-dashboard";
export const OWNER_CONTRACTORS_QUERY = "owner-contractors";
export const OWNER_CONTRACTOR_QUERY = "owner-contractor";
export const OWNER_INVITATION_QUERY = "owner-invitation";
export const OWNER_SITES_QUERY = "owner-sites";
export const OWNER_ME_QUERY = "owner-me";

export const OWNER_QUERY_ROOTS = [
  OWNER_DASHBOARD_QUERY,
  OWNER_CONTRACTORS_QUERY,
  OWNER_CONTRACTOR_QUERY,
  OWNER_INVITATION_QUERY,
  OWNER_SITES_QUERY,
  OWNER_ME_QUERY,
] as const;

export const OWNER_ME_PATH = "/api/me";
export const OWNER_SITES_PATH = "/api/sites";
export const OWNER_CONTRACTORS_PATH = "/api/contractors";
export const OWNER_WEB_DASHBOARD_PATH = "/dashboard";

export type OwnerReadCode =
  | "invalid_week"
  | "unauthorized"
  | "business_required"
  | "offline"
  | "not_found"
  | "unavailable";

export class OwnerReadError extends Error {
  readonly code: OwnerReadCode;

  constructor(code: OwnerReadCode) {
    super(code);
    this.name = "OwnerReadError";
    this.code = code;
  }
}

export function ownerReadMessage(error: unknown): { title: string; detail: string; finishOnWeb: boolean } {
  const code = error instanceof OwnerReadError ? error.code : "unavailable";
  if (code === "business_required") {
    return {
      title: "Finish setup on web",
      detail: "Create the business in the web dashboard. This app only reads it.",
      finishOnWeb: true,
    };
  }
  if (code === "invalid_week") {
    return {
      title: "That week is not a Monday.",
      detail: "Pick another week. Weeks start on Monday.",
      finishOnWeb: false,
    };
  }
  if (code === "unauthorized") {
    return { title: "Sign in again", detail: "Your session ended.", finishOnWeb: false };
  }
  if (code === "offline") {
    return { title: "You're offline", detail: "Pull to refresh when you're back online.", finishOnWeb: false };
  }
  if (code === "not_found") {
    return { title: "Not available", detail: "That record is not on this account.", finishOnWeb: false };
  }
  return { title: "Couldn't load CleanTrack", detail: "Check your connection and try again.", finishOnWeb: false };
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  const code = body.error;
  return typeof code === "string" ? code : "";
}

export function ownerReadErrorFromResponse(status: number, body: unknown): OwnerReadError {
  const code = errorCode(body);
  if (status === 401 || code === "unauthorized") return new OwnerReadError("unauthorized");
  if (status === 409 && code === "business_required") return new OwnerReadError("business_required");
  if (status === 400 && code === "invalid_week") return new OwnerReadError("invalid_week");
  if (status === 404 || code === "not_found") return new OwnerReadError("not_found");
  return new OwnerReadError("unavailable");
}

export function ownerReadRequest(path: string): { method: typeof OWNER_HTTP_METHOD; path: string } {
  if (
    typeof path !== "string"
    || !path.startsWith("/api/")
    || path.startsWith("//")
    || path.includes("://")
    || path.includes("apply-schedule")
    || path.includes("/api/weeks")
  ) {
    throw new OwnerReadError("unavailable");
  }
  return { method: OWNER_HTTP_METHOD, path };
}

export function ownerDashboardPath(weekStart: string): string {
  if (!isMonday(weekStart)) throw new OwnerReadError("invalid_week");
  return `/api/dashboard?week=${encodeURIComponent(weekStart)}`;
}

function ownerResourceId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new OwnerReadError("not_found");
  return id;
}

export function ownerContractorPath(id: string): string {
  return `/api/contractors/${ownerResourceId(id)}`;
}

export function ownerInvitationPath(id: string): string {
  return `/api/contractors/${ownerResourceId(id)}/invitation`;
}

export type OwnerLoadResult = { status: number; body: unknown };

export async function readOwner<T>(
  path: string,
  schema: ZodType<T>,
  load: (path: string, method: typeof OWNER_HTTP_METHOD) => Promise<OwnerLoadResult>,
): Promise<T> {
  const request = ownerReadRequest(path);
  try {
    const result = await load(request.path, request.method);
    if (result.status !== 200) throw ownerReadErrorFromResponse(result.status, result.body);
    const parsed = schema.safeParse(result.body);
    if (!parsed.success) throw new OwnerReadError("unavailable");
    return parsed.data;
  } catch (error) {
    if (error instanceof OwnerReadError) throw error;
    throw new OwnerReadError("offline");
  }
}
