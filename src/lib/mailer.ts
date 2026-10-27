import { env } from "cloudflare:workers";
import { getEmailConfig } from "@/lib/runtime-env";
import { decideTransport, type MailConfig } from "@/lib/mail-transport";
import { deliverMailpit, deliverSmtp, openCloudflareSmtp, type SmtpByteStream } from "@/lib/smtp-dev";
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
  config: MailConfig = readMailConfig(),
  fetchImpl: typeof fetch = fetch,
  openSmtp: () => Promise<SmtpByteStream> = () => openDevSmtp(config),
): Promise<SendEmailResult> {
  const transport = decideTransport(config);
  if (transport === "refused") {
    reportOperationalEvent("email_dev_transport_refused", { kind: input.kind });
    return { status: "failed", httpStatus: 0 };
  }
  if (transport === "smtp-dev") return sendDevSmtp(input, config, openSmtp, fetchImpl);
  if (config.apiKey.trim() === "" || config.from.trim() === "") {
    reportOperationalEvent("email_not_configured", { kind: input.kind });
    return { status: "not_configured" };
  }
  return postResend(input, config, fetchImpl);
}

function readMailConfig(): MailConfig {
  return {
    ...getEmailConfig(),
    transport: envString("MAIL_TRANSPORT"),
    smtpHost: envString("SMTP_HOST") || "localhost",
    smtpPort: parsePort(envString("SMTP_PORT")),
    smtpHttpPort: parseHttpPort(envString("SMTP_HTTP_PORT")),
    production: process.env.NODE_ENV === "production",
  };
}

function envString(name: string): string {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

function parsePort(value: string): number {
  if (value === "") return 1025;
  const port = Number(value);
  return Number.isInteger(port) ? port : 0;
}

function parseHttpPort(value: string): number {
  if (value === "") return 8025;
  const port = Number(value);
  return Number.isInteger(port) ? port : 0;
}

function openDevSmtp(config: MailConfig): Promise<SmtpByteStream> {
  return openCloudflareSmtp(config.smtpHost?.trim() || "localhost", config.smtpPort ?? 1025);
}

async function sendDevSmtp(
  input: SendEmailInput,
  config: MailConfig,
  openSmtp: () => Promise<SmtpByteStream>,
  fetchImpl: typeof fetch,
): Promise<SendEmailResult> {
  const message = { from: config.from, to: input.to, subject: input.subject, text: input.text, html: input.html };
  try {
    await deliverSmtp(message, openSmtp);
    return { status: "sent", id: "smtp-dev" };
  } catch {
    return sendDevHttp(input, message, config, fetchImpl);
  }
}

async function sendDevHttp(
  input: SendEmailInput,
  message: { from: string; to: string; subject: string; text: string; html: string },
  config: MailConfig,
  fetchImpl: typeof fetch,
): Promise<SendEmailResult> {
  try {
    await deliverMailpit(message, mailpitEndpoint(config), fetchImpl);
    return { status: "sent", id: "smtp-dev" };
  } catch {
    return failed(input.kind, 0);
  }
}

function mailpitEndpoint(config: MailConfig): string {
  const host = config.smtpHost?.trim() || "localhost";
  const formatted = host.includes(":") ? `[${host}]` : host;
  return `http://${formatted}:${config.smtpHttpPort ?? 8025}/api/v1/send`;
}

async function postResend(input: SendEmailInput, config: MailConfig, fetchImpl: typeof fetch): Promise<SendEmailResult> {
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

function resendRequest(input: SendEmailInput, config: MailConfig, signal: AbortSignal): RequestInit {
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
