import { z } from "zod";

export const OWNER_ASSISTANT_CONFIRM_TTL_MS = 5 * 60 * 1000;

const rateCents = z.number().int().min(1_500).max(25_000);
const actionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create_contractor"), name: z.string().min(1).max(100),
    email: z.string().max(254), phone: z.string().max(40), defaultRateCents: rateCents,
  }).strict(),
  z.object({ kind: z.literal("create_site"), name: z.string().min(1).max(100), address: z.string().max(240) }).strict(),
  z.object({
    kind: z.literal("assign_site"), contractorId: z.string().min(1).max(64), siteId: z.string().min(1).max(64),
    contractorName: z.string().min(1).max(100), siteName: z.string().min(1).max(100), rateCents: rateCents.nullable(),
  }).strict(),
]);

const payloadSchema = z.object({
  exp: z.number().int().positive(),
  nonce: z.string().uuid(),
  ownerUserId: z.string().min(1),
  action: actionSchema,
}).strict();

export type OwnerAssistantConfirmedAction = z.infer<typeof actionSchema>;
type Payload = z.infer<typeof payloadSchema>;

function bytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy;
}

function encode(value: Uint8Array | string): string {
  const data = typeof value === "string" ? bytes(value) : value;
  let binary = "";
  for (const byte of data) binary += String.fromCodePoint(byte);
  let encoded = btoa(binary).replaceAll("+", "-").replaceAll("/", "_");
  while (encoded.endsWith("=")) encoded = encoded.slice(0, -1);
  return encoded;
}

function isBase64Url(value: string): boolean {
  return value.length > 0 && [...value].every((character) => {
    const point = character.codePointAt(0) ?? -1;
    return (point >= 48 && point <= 57) || (point >= 65 && point <= 90) || (point >= 97 && point <= 122) || character === "_" || character === "-";
  });
}

function decode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!isBase64Url(value)) return null;
  try {
    const padded = value + "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const decoded = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
    const copy = new Uint8Array(decoded.byteLength);
    copy.set(decoded);
    return copy;
  } catch {
    return null;
  }
}

async function key(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey("raw", bytes(secret), { name: "HMAC", hash: "SHA-256" }, false, usages);
}

export async function signOwnerAssistantConfirmation(
  ownerUserId: string,
  action: OwnerAssistantConfirmedAction,
  secret: string,
  nowMs = Date.now(),
): Promise<{ token: string; expiresAt: string }> {
  const payload: Payload = { exp: nowMs + OWNER_ASSISTANT_CONFIRM_TTL_MS, nonce: crypto.randomUUID(), ownerUserId, action };
  const text = JSON.stringify(payload);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret, ["sign"]), bytes(text)));
  return { token: `v1.${encode(text)}.${encode(signature)}`, expiresAt: new Date(payload.exp).toISOString() };
}

export async function readOwnerAssistantConfirmation(
  token: string,
  secret: string,
  nowMs = Date.now(),
): Promise<{ ok: true; payload: Payload } | { ok: false; error: "confirm_mismatch" | "confirm_expired" }> {
  const [version, encodedPayload, encodedSignature, extra] = token.split(".");
  if (version !== "v1" || !encodedPayload || !encodedSignature || extra) return { ok: false, error: "confirm_mismatch" };
  const payloadBytes = decode(encodedPayload);
  const signature = decode(encodedSignature);
  if (!payloadBytes || !signature) return { ok: false, error: "confirm_mismatch" };
  const signatureBytes = new Uint8Array(signature.byteLength);
  signatureBytes.set(signature);
  const valid = await crypto.subtle.verify("HMAC", await key(secret, ["verify"]), signatureBytes, payloadBytes);
  if (!valid) return { ok: false, error: "confirm_mismatch" };
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder().decode(payloadBytes)); } catch { return { ok: false, error: "confirm_mismatch" }; }
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "confirm_mismatch" };
  if (parsed.data.exp <= nowMs) return { ok: false, error: "confirm_expired" };
  return { ok: true, payload: parsed.data };
}
