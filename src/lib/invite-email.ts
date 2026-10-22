export type InviteEmail = { to: string; subject: string; text: string; html: string };
export interface EmailSender { send(message: InviteEmail): Promise<void>; }

export type EmailEnvironment = {
  EMAIL_PROVIDER?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  MAILPIT_URL?: string;
  APP_BASE_URL?: string;
};

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function contractorInviteEmail(input: { to: string; businessName: string; acceptUrl: string; expiresAt: Date }): InviteEmail {
  const expiry = input.expiresAt.toISOString();
  const subject = `Invitation to ${input.businessName.replace(/[\r\n]+/g, " ")} on CleanTrack`;
  return {
    to: input.to,
    subject,
    text: `${input.businessName} invited you to CleanTrack.\n\nAccept invitation: ${input.acceptUrl}\n\nThis link expires ${expiry}.`,
    html: `<p><strong>${escapeHtml(input.businessName)}</strong> invited you to CleanTrack.</p><p><a href="${escapeHtml(input.acceptUrl)}">Accept invitation</a></p><p>This link expires ${escapeHtml(expiry)}.</p>`,
  };
}

async function sendChecked(fetcher: typeof fetch, url: string, init: RequestInit): Promise<void> {
  const response = await fetcher(url, init);
  if (!response.ok) throw new Error("email_delivery_failed");
}

function applicationBaseUrl(environment: EmailEnvironment): URL {
  if (!environment.APP_BASE_URL) throw new Error("email_not_configured");
  try {
    const parsed = new URL(environment.APP_BASE_URL);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("email_not_configured");
    return parsed;
  } catch {
    throw new Error("email_not_configured");
  }
}

export function createEmailSender(environment: EmailEnvironment, fetcher: typeof fetch = fetch): EmailSender {
  if (environment.EMAIL_PROVIDER === "resend") {
    if (!environment.RESEND_API_KEY || !environment.EMAIL_FROM) throw new Error("email_not_configured");
    applicationBaseUrl(environment);
    return { send: async (message) => sendChecked(fetcher, "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${environment.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: environment.EMAIL_FROM, to: [message.to], subject: message.subject, text: message.text, html: message.html }),
    }) };
  }
  if (environment.EMAIL_PROVIDER === "mailpit") {
    if (!environment.MAILPIT_URL || !environment.EMAIL_FROM || !environment.APP_BASE_URL) throw new Error("email_not_configured");
    let mailpit: URL;
    try { mailpit = new URL(environment.MAILPIT_URL); }
    catch { throw new Error("email_not_configured"); }
    const app = applicationBaseUrl(environment);
    if (![mailpit.hostname, app.hostname].every((host) => host === "localhost" || host === "127.0.0.1" || host === "[::1]")) throw new Error("email_not_configured");
    return { send: async (message) => sendChecked(fetcher, new URL("/api/v1/send", mailpit).toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ From: { Email: environment.EMAIL_FROM }, To: [{ Email: message.to }], Subject: message.subject, Text: message.text, HTML: message.html }),
    }) };
  }
  throw new Error("email_not_configured");
}
