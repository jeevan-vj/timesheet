import { bytesToHex, hexToBytes, sha256Bytes, timingSafeEqual } from "@/lib/crypto";

const TOKEN_BYTES = 32;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function generateInvitationToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function invitationTokenDigest(token: string): Promise<string> {
  return bytesToHex(await sha256Bytes(token));
}

export async function invitationTokenMatches(token: string, digestHex: string): Promise<boolean> {
  const expected = hexToBytes(digestHex);
  if (!expected) return false;
  const actual = await sha256Bytes(token);
  return timingSafeEqual(actual, expected);
}

export function invitationAcceptUrl(publicUrl: string, token: string): string {
  const base = publicUrl.endsWith("/") ? publicUrl : `${publicUrl}/`;
  const url = new URL("/invite", base);
  url.search = "";
  url.hash = token;
  return url.toString();
}
