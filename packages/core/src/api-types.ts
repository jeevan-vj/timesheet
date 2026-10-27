import type { EngagementStatus } from "./engagement";

export const API_ERROR_CODES = [
  "already_linked",
  "business_required",
  "contractor_email_required",
  "duplicate_assignment",
  "duplicate_contractor",
  "duplicate_entry",
  "duplicate_site",
  "forbidden",
  "internal_error",
  "invalid_request",
  "invalid_shift",
  "invalid_week",
  "invitation_conflict",
  "invitation_exists",
  "invitation_not_pending",
  "missing_remitter",
  "no_entries",
  "no_schedule",
  "not_found",
  "payload_too_large",
  "resend_too_soon",
  "schedule_exists",
  "service_unavailable",
  "stale_week",
  "unauthorized",
  "week_locked",
  "week_not_approved",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ApiErrorBody = {
  error: ApiErrorCode;
  correlationId?: string;
  fields?: Record<string, string>;
};

export type HealthResponse =
  | { status: "ok"; database: "ok"; release: string }
  | { status: "unavailable" };

export type BusinessResource = {
  id: string;
  name: string;
  nzbn: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  currency: string;
  weekStart: string;
  onboardingCompletedAt: string | null;
};

export type ContractorResource = {
  id: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  currency: "NZD";
  active: boolean;
  preferredName: string;
  startDate: string | null;
  engagementStatus: EngagementStatus;
  gstRegistered: boolean;
  gstNumber: string;
  internalNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  createdAt: string;
  updatedAt: string;
};

export type WeekApprovalResource = {
  id: string;
  weekStart: string;
  status: "approved" | "reopened";
  approvedAt: string;
  reopenedAt: string | null;
};

export function isApiErrorCode(value: string): value is ApiErrorCode {
  return (API_ERROR_CODES as readonly string[]).includes(value);
}
