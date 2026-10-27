export const MOBILE_CLIENT_HEADER: "X-CleanTrack-Client";
export const PRODUCTION_API_URL: "https://cleantrack-timesheet.jeevan90wijerathna.workers.dev";

export type ApiTransport = "native" | "web";

export type ViewerRole = "contractor" | "owner" | "owner_and_contractor" | "none";

export type ApiBaseSources = {
  publicUrl?: string | null;
  extraUrl?: string | null;
};

export type ApiRequestInput = {
  baseUrl: string;
  path: string;
  version: string;
  cookie?: string | null;
  headers?: HeadersInit;
  transport?: ApiTransport;
};

export type ApiRequest = {
  url: string;
  headers: Record<string, string>;
  credentials: "omit" | "include";
};

export function resolveApiBaseUrl(sources?: ApiBaseSources): string;
export function mobileClientValue(version: string): string;
export function buildApiRequest(input: ApiRequestInput): ApiRequest;
export function viewerRole(viewer: { owner?: unknown; contractorOf?: readonly unknown[] } | null | undefined): ViewerRole;
export function roleLabel(role: ViewerRole): string;
export function signInErrorMessage(input?: { status?: number; offline?: boolean }): string;
export function sessionEndsOnStatus(status: number): boolean;
