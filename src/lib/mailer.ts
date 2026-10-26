import { getEmailConfig, type EmailConfig } from "@/lib/runtime-env";
import { reportOperationalEvent, type OperationalKind } from "@/lib/report-server-error";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const EMAIL_TIMEOUT_MS = 5_000;

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  replyTo: string;
  kind: OperationalKind;
};

export type SendEmailResult =
  | { status: "sent"; id: string }
  | { status: "not_configured" }
  | { status: "failed"; httpStatus: number };

export async function sendEmail(
  input: SendEmailInput,
  config: EmailConfig = getEmailConfig(),
  fetchImpl: typeof fetch = fetch,
): Promise<SendEmailResult> {
  if (config.apiKey.trim() === "" || config.from.trim() === "") {
    reportOperationalEvent("email_not_configured", { kind: input.kind });
    return { status: "not_configured" };
  }
  return postResend(input, config, fetchImpl);
}

async function postResend(input: SendEmailInput, config: EmailConfig, fetchImpl: typeof fetch): Promise<SendEmailResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);
  try {
    const response = await fetchImpl(RESEND_EMAILS_URL, resendRequest(input, config, controller.signal));
    if (!response.ok) return failed(input.kind, response.status);
    const id = await readResendId(response);
    if (!id) return failed(input.kind, response.status);
    return { status: "sent", id };
  } catch {
    return failed(input.kind, 0);
  } finally {
    clearTimeout(timer);
  }
}

function resendRequest(input: SendEmailInput, config: EmailConfig, signal: AbortSignal): RequestInit {
  return {
    method: "POST",
    signal,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(resendBody(input, config.from)),
  };
}

function resendBody(input: SendEmailInput, from: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    from,
    to: [input.to],
    subject: input.subject,
    html: input.html,
    text: input.text,
  };
  const replyTo = input.replyTo.trim();
  if (replyTo) body.reply_to = replyTo;
  return body;
}

async function readResendId(response: Response): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("id" in payload)) return "";
    return typeof payload.id === "string" ? payload.id : "";
  } catch {
    return "";
  }
}

function failed(kind: OperationalKind, httpStatus: number): SendEmailResult {
  reportOperationalEvent("email_send_failed", { kind, httpStatus });
  return { status: "failed", httpStatus };
}
