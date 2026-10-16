function bytesOf(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

export async function sha256Bytes(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytesOf(value));
  return new Uint8Array(digest);
}

export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i]! ^ right[i]!;
  return diff === 0;
}

export async function opsBearerAuthorized(authorization: string | null, secret: string): Promise<boolean> {
  const prefix = "Bearer ";
  const presented = authorization?.startsWith(prefix) ? authorization.slice(prefix.length) : "";
  if (secret.length === 0 || presented.length === 0) return false;
  const [left, right] = await Promise.all([sha256Bytes(presented), sha256Bytes(secret)]);
  return timingSafeEqual(left, right);
}
