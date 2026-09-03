const SENSITIVE_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key|x-auth-token)$/i;
const SECRET_QUERY = /^(token|access_token|refresh_token|id_token|session|auth|password|secret|code)$/i;

export function sanitizeUrl(value) {
  try {
    const url = new URL(String(value ?? ""), "http://factory.invalid");
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_QUERY.test(key)) url.searchParams.set(key, "redacted");
    }
    if (url.hostname === "factory.invalid") {
      return `${url.pathname}${url.search}`;
    }
    return url.toString();
  } catch {
    return "[unparseable-url]";
  }
}

export function sanitizeHeaders(headers) {
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Object.entries(headers ?? {});
  const out = {};
  for (const [name, value] of entries) {
    out[name] = SENSITIVE_HEADER.test(name) ? "redacted" : String(value ?? "");
  }
  return out;
}

export function sanitizeConsoleEntry(entry) {
  const type = String(entry?.type ?? "log");
  const text = String(entry?.text ?? "").slice(0, 500);
  return { type, text: redactSecrets(text) };
}

export function sanitizeNetworkEntry(entry) {
  return {
    method: String(entry?.method ?? "GET").toUpperCase(),
    url: sanitizeUrl(entry?.url),
    status: Number.isInteger(entry?.status) ? entry.status : null,
    failed: Boolean(entry?.failed),
    failure: entry?.failure ? redactSecrets(String(entry.failure).slice(0, 200)) : null,
  };
}

export function redactSecrets(text) {
  return String(text ?? "")
    .replace(/(Bearer\s+)[A-Za-z0-9._\-+=/]+/gi, "$1redacted")
    .replace(/((?:password|secret|token|cookie)\s*[:=]\s*)\S+/gi, "$1redacted");
}

export function looksLikePng(buffer) {
  if (!buffer || buffer.length < 8) return false;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

export function looksLikeZip(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  return bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
}
