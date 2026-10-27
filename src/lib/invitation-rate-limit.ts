import { and, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { rateLimit } from "@/db/schema";
import { isTrustedMutationRequest, noStoreJson } from "@/lib/accounts-config";
import { getTrustedOrigins } from "@/lib/runtime-env";

type Database = typeof db;

const WINDOW_MS = 60_000;
const LIMITS = { preview: 30, accept: 5 } as const;

export type InviteBucket = keyof typeof LIMITS;

export function inviteMutationAllowed(request: Request, trustedOrigins: string[]): boolean {
  const origin = request.headers.get("origin");
  if (!origin || !trustedOrigins.includes(origin)) return false;
  return isTrustedMutationRequest(request, trustedOrigins);
}

export function clientAddress(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim() ?? "";
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  const raw = cf || forwarded || "local";
  const cleaned = raw.replace(/[^\w.:-]/g, "").slice(0, 64);
  return cleaned || "local";
}

export function clientUserAgent(request: Request): string {
  return (request.headers.get("user-agent") ?? "").slice(0, 512);
}

type RateClaim = "allowed" | "denied" | "lost";

export async function consumeInvitationRate(
  database: Database,
  bucket: InviteBucket,
  address: string,
  nowMs: number,
): Promise<boolean> {
  const key = `invite-${bucket}:${address}`;
  const first = await claimInvitationSlot(database, key, LIMITS[bucket], nowMs);
  if (first !== "lost") return first === "allowed";
  return await claimInvitationSlot(database, key, LIMITS[bucket], nowMs) === "allowed";
}

async function claimInvitationSlot(database: Database, key: string, limit: number, nowMs: number): Promise<RateClaim> {
  const [row] = await database.select().from(rateLimit).where(eq(rateLimit.key, key)).limit(1);
  if (!row || nowMs - row.lastRequest >= WINDOW_MS) {
    await openRateWindow(database, key, nowMs);
    return "allowed";
  }
  if (row.count >= limit) return "denied";
  const changed = await incrementRateCount(database, key, row.count);
  return changed ? "allowed" : "lost";
}

async function incrementRateCount(database: Database, key: string, count: number): Promise<boolean> {
  const changed = await database.update(rateLimit).set({ count: count + 1 }).where(and(
    eq(rateLimit.key, key),
    eq(rateLimit.count, count),
  )).returning({ id: rateLimit.id });
  return changed.length > 0;
}

async function openRateWindow(database: Database, key: string, nowMs: number): Promise<void> {
  await database.insert(rateLimit).values({
    id: crypto.randomUUID(),
    key,
    count: 1,
    lastRequest: nowMs,
  }).onConflictDoUpdate({
    target: rateLimit.key,
    set: { count: 1, lastRequest: nowMs },
  });
}

export async function beginInvitePost(request: Request, database: Database, bucket: InviteBucket): Promise<{ address: string } | Response> {
  if (!inviteMutationAllowed(request, getTrustedOrigins())) return noStoreJson({ error: "forbidden" }, 403);
  const address = clientAddress(request);
  const allowed = await consumeInvitationRate(database, bucket, address, Date.now());
  if (!allowed) return noStoreJson({ error: "rate_limited" }, 429);
  return { address };
}
