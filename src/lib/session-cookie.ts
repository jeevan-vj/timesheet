import { getCookies } from "better-auth/cookies";

export const SESSION_SECONDS = 60 * 60 * 24 * 7;

export async function sessionSetCookie(input: {
  token: string;
  secret: string;
  baseURL: string;
  secure: boolean;
}): Promise<string> {
  if (input.secret.trim() === "" || input.baseURL.trim() === "") throw new Error("auth_unavailable");
  const cookies = getCookies({
    baseURL: input.baseURL,
    advanced: { useSecureCookies: input.secure },
    session: { expiresIn: SESSION_SECONDS },
  } as Parameters<typeof getCookies>[0]);
  const attributes = cookies.sessionToken.attributes;
  const sameSite = String(attributes.sameSite ?? "lax");
  const parts = [
    `${cookies.sessionToken.name}=${await signCookieValue(input.token, input.secret)}`,
    `Max-Age=${attributes.maxAge ?? SESSION_SECONDS}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`,
  ];
  if (attributes.secure) parts.push("Secure");
  return parts.join("; ");
}

async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return encodeURIComponent(`${value}.${btoa(binary)}`);
}
