export type MailConfig = {
  apiKey: string;
  from: string;
  transport?: string;
  smtpHost?: string;
  smtpPort?: number;
  production?: boolean;
};

export type MailTransport = "resend" | "smtp-dev" | "refused";

export function decideTransport(config: MailConfig): MailTransport {
  if ((config.transport ?? "").trim() !== "smtp-dev") return "resend";
  if (config.production) return "refused";
  if (!isLoopbackHost(config.smtpHost?.trim() || "localhost")) return "refused";
  if (!isSmtpPort(config.smtpPort ?? 1025)) return "refused";
  return "smtp-dev";
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function isSmtpPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function mailboxAddress(value: string): string | null {
  const cleaned = value.replaceAll(/[\r\n]+/g, " ").trim();
  const wrapped = cleaned.match(/<([^<>\s]+)>/);
  const address = (wrapped?.[1] ?? cleaned).trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(address)) return null;
  return address;
}
