import { isMonday, ownerRemittanceSchema, type OwnerRemittance } from "@cleantrack/core";

export const OWNER_REMITTANCE_ACCEPT = "application/vnd.cleantrack.remittance+json";

export type OwnerRemittanceCode =
  | "invalid_week"
  | "unauthorized"
  | "no_entries"
  | "not_found"
  | "offline"
  | "unavailable";

export class OwnerRemittanceError extends Error {
  readonly code: OwnerRemittanceCode;

  constructor(code: OwnerRemittanceCode) {
    super(code);
    this.name = "OwnerRemittanceError";
    this.code = code;
  }
}

export type OwnerRemittanceSend = (
  path: string,
  init: { method: "GET"; headers: { accept: typeof OWNER_REMITTANCE_ACCEPT } },
) => Promise<{ status: number; body: unknown }>;

function resourceId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new OwnerRemittanceError("not_found");
  return id;
}

export function ownerRemittancePath(contractorId: string, weekStart: string): string {
  if (!isMonday(weekStart)) throw new OwnerRemittanceError("invalid_week");
  return `/api/contractors/${resourceId(contractorId)}/remittance?week=${encodeURIComponent(weekStart)}`;
}

function responseCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function responseError(status: number, body: unknown): OwnerRemittanceError {
  const code = responseCode(body);
  if (status === 401 || code === "unauthorized") return new OwnerRemittanceError("unauthorized");
  if (status === 400 && code === "no_entries") return new OwnerRemittanceError("no_entries");
  if (status === 400 && code === "invalid_week") return new OwnerRemittanceError("invalid_week");
  if (status === 404 || code === "not_found") return new OwnerRemittanceError("not_found");
  return new OwnerRemittanceError("unavailable");
}

export function ownerRemittanceMessage(error: unknown): { title: string; detail: string } {
  const code = error instanceof OwnerRemittanceError ? error.code : "unavailable";
  if (code === "unauthorized") return { title: "Sign in again", detail: "Your session ended." };
  if (code === "no_entries") return { title: "No remittance for this week", detail: "This contractor has no recorded shifts for the selected week." };
  if (code === "invalid_week") return { title: "That week is not available", detail: "Weeks must start on Monday." };
  if (code === "not_found") return { title: "Remittance not available", detail: "This contractor is not available on your account." };
  if (code === "offline") return { title: "You're offline", detail: "Check your connection and try again." };
  return { title: "Couldn't load remittance", detail: "Try again in a moment." };
}

export async function loadOwnerRemittance(
  contractorId: string,
  weekStart: string,
  send: OwnerRemittanceSend,
): Promise<OwnerRemittance> {
  const path = ownerRemittancePath(contractorId, weekStart);
  try {
    const response = await send(path, {
      method: "GET",
      headers: { accept: OWNER_REMITTANCE_ACCEPT },
    });
    if (response.status !== 200) throw responseError(response.status, response.body);
    const parsed = ownerRemittanceSchema.safeParse(response.body);
    if (!parsed.success) throw new OwnerRemittanceError("unavailable");
    return parsed.data;
  } catch (error) {
    if (error instanceof OwnerRemittanceError) throw error;
    throw new OwnerRemittanceError("offline");
  }
}
