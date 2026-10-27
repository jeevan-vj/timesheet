const TRACE_LINES = 6;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const BEARER = /\b(?:bearer|authorization)\s+\S+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_PARAM = /((?:token|password|secret|code|session|access_token)=)[^&\s]+/gi;
const SECRET_JSON = /("(?:token|password|secret|code|session|access_token)"\s*:\s*")[^"]*/gi;
const URL_QUERY = /(https?:\/\/[^\s?#)]+)\?[^\s)]*/g;

export function screenErrorCause(error: { name?: string; message?: string } | null | undefined): string {
  const name = typeof error?.name === "string" && error.name.trim() ? error.name.trim() : "Error";
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return redactScreenText(message ? `${name}: ${message}` : name);
}

export function redactScreenText(value: string): string {
  return value
    .replace(URL_QUERY, "$1")
    .replace(SECRET_PARAM, "$1[redacted]")
    .replace(SECRET_JSON, "$1[redacted]")
    .replace(BEARER, "[redacted]")
    .replace(JWT, "[redacted]")
    .replace(EMAIL, "[redacted]");
}

function firstLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, TRACE_LINES);
}

export function screenErrorTrace(
  error: { stack?: string } | null | undefined,
  componentStack?: string | null,
): string {
  const stack = typeof error?.stack === "string" ? firstLines(error.stack) : [];
  const components = typeof componentStack === "string" ? firstLines(componentStack) : [];
  const lines = [...stack, ...components];
  if (lines.length === 0) return "";
  return redactScreenText(lines.join("\n"));
}
