import { sha256Bytes, timingSafeEqual } from "@/lib/crypto";

export { sha256Bytes, timingSafeEqual } from "@/lib/crypto";

export async function opsBearerAuthorized(authorization: string | null, secret: string): Promise<boolean> {
  const prefix = "Bearer ";
  const presented = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (secret.length === 0 || presented.length === 0) return false;
  const [left, right] = await Promise.all([sha256Bytes(presented), sha256Bytes(secret)]);
  return timingSafeEqual(left, right);
}
