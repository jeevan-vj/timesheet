import { isMonday } from "@cleantrack/core";

const RESOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const PDF_TYPE = "application/pdf";
const MAX_PDF_BYTES = 5 * 1024 * 1024;

export type ContractorRemittanceTarget = {
  businessId: string;
  businessName: string;
  weekStart: string;
  weekEnd: string;
};

export type ContractorRemittanceCode =
  | "invalid_week"
  | "not_found"
  | "no_entries"
  | "offline"
  | "sharing_unavailable"
  | "share_failed"
  | "unavailable";

export class ContractorRemittanceError extends Error {
  readonly code: ContractorRemittanceCode;

  constructor(code: ContractorRemittanceCode) {
    super(code);
    this.name = "ContractorRemittanceError";
    this.code = code;
  }
}

export type ContractorRemittanceDownloadResponse = {
  status: number;
  contentType: string | null;
  contentDisposition: string | null;
  body: Uint8Array | null;
  errorBody: unknown;
};

type TemporaryFile = { uri: string; remove: () => Promise<void> };

export type ContractorRemittanceDependencies = {
  send: (path: string) => Promise<ContractorRemittanceDownloadResponse>;
  save: (filename: string, body: Uint8Array) => Promise<TemporaryFile>;
  share: (uri: string, filename: string) => Promise<void>;
};

export function portalRemittancePath(target: ContractorRemittanceTarget): string {
  if (!isMonday(target.weekStart)) throw new ContractorRemittanceError("invalid_week");
  if (!RESOURCE_ID.test(target.businessId)) throw new ContractorRemittanceError("not_found");
  return `/api/portal/payments/${encodeURIComponent(target.weekStart)}/remittance/${encodeURIComponent(target.businessId)}`;
}

function responseCode(body: unknown): string {
  if (!body || typeof body !== "object" || !("error" in body)) return "";
  return typeof body.error === "string" ? body.error : "";
}

function responseError(response: ContractorRemittanceDownloadResponse): ContractorRemittanceError {
  const code = responseCode(response.errorBody);
  if (code === "no_entries") return new ContractorRemittanceError("no_entries");
  if (code === "invalid_week") return new ContractorRemittanceError("invalid_week");
  if (response.status === 404 || code === "not_found") return new ContractorRemittanceError("not_found");
  return new ContractorRemittanceError("unavailable");
}

function downloadFilename(disposition: string | null, weekEnd: string): string {
  const candidate = disposition?.match(/filename="([A-Za-z0-9._-]+\.pdf)"/i)?.[1] ?? "";
  return candidate || `remittance-${weekEnd}.pdf`;
}

export function contractorRemittanceMessage(error: unknown): { title: string; detail: string } {
  const code = error instanceof ContractorRemittanceError ? error.code : "unavailable";
  if (code === "offline") return { title: "You're offline", detail: "Connect to the internet and try again." };
  if (code === "not_found" || code === "no_entries") {
    return { title: "Remittance not available", detail: "This approved remittance is no longer available. Refresh Pay and try again." };
  }
  if (code === "invalid_week") return { title: "That week is invalid", detail: "Refresh Pay and select an approved week." };
  if (code === "sharing_unavailable") return { title: "Sharing unavailable", detail: "This device cannot open the PDF share sheet." };
  if (code === "share_failed") return { title: "Couldn't share PDF", detail: "The temporary PDF was removed. Try again." };
  return { title: "Couldn't download PDF", detail: "Try again in a moment." };
}

export async function downloadContractorRemittance(
  target: ContractorRemittanceTarget,
  dependencies: ContractorRemittanceDependencies,
): Promise<void> {
  let response: ContractorRemittanceDownloadResponse;
  try {
    response = await dependencies.send(portalRemittancePath(target));
  } catch (error) {
    if (error instanceof ContractorRemittanceError) throw error;
    throw new ContractorRemittanceError("offline");
  }
  if (response.status !== 200) throw responseError(response);
  if (!response.contentType?.toLowerCase().startsWith(PDF_TYPE) || !response.body) {
    throw new ContractorRemittanceError("unavailable");
  }
  if (response.body.byteLength === 0 || response.body.byteLength > MAX_PDF_BYTES) {
    throw new ContractorRemittanceError("unavailable");
  }
  const filename = downloadFilename(response.contentDisposition, target.weekEnd);
  let temporary: TemporaryFile;
  try {
    temporary = await dependencies.save(filename, response.body);
  } catch {
    throw new ContractorRemittanceError("unavailable");
  }
  try {
    await dependencies.share(temporary.uri, filename);
  } catch (error) {
    if (error instanceof ContractorRemittanceError) throw error;
    throw new ContractorRemittanceError("share_failed");
  } finally {
    await temporary.remove().catch(() => undefined);
  }
}
