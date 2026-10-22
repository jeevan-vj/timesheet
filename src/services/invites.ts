import { and, eq, exists, gt, inArray, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import { business, contractorInvites, contractors, contractorUsers } from "@/db/schema";
import { ownerBusinessIdOrNull, requireOwnerBusinessId } from "@/lib/business";
import { contractorMayHoldPortalAccess } from "@/lib/contractor-lifecycle";
import { assertInviteCanAccept, assertInviteCanResend, assertInviteCanRevoke, effectiveInviteStatus, inviteExpiryFrom, type InviteStatus } from "@/lib/invite-state";
import { createInviteToken, hashInviteToken, validInviteTokenShape } from "@/lib/invite-token";
import { isUniqueConstraintError } from "@/lib/db-errors";

type Database = typeof db;
type InviteRow = typeof contractorInvites.$inferSelect;

export type InviteResource = {
  id: string;
  contractorId: string;
  status: InviteStatus;
  expiresAt: string;
};

export type InviteDelivery = InviteResource & {
  rawToken: string;
  invitedEmail: string;
  businessName: string;
};

function normalizeEmail(value: string): string { return value.trim().toLowerCase(); }
function changedRows(result: unknown): number | null {
  if (!result || typeof result !== "object") return null;
  if ("meta" in result && result.meta && typeof result.meta === "object" && "changes" in result.meta && typeof result.meta.changes === "number") return result.meta.changes;
  if ("changes" in result && typeof result.changes === "number") return result.changes;
  if ("rowsAffected" in result && typeof result.rowsAffected === "number") return result.rowsAffected;
  return null;
}

function requireSingleChange(result: unknown, error = "invite_unavailable"): void {
  if (changedRows(result) !== 1) throw new Error(error);
}
function toResource(row: InviteRow, now = new Date()): InviteResource {
  return { id: row.id, contractorId: row.contractorId, status: effectiveInviteStatus(row.status, row.expiresAt, now), expiresAt: row.expiresAt.toISOString() };
}

async function ownerContext(database: Database, ownerUserId: string, contractorId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [row] = await database.select({
    contractorId: contractors.id,
    email: contractors.email,
    engagementStatus: contractors.engagementStatus,
    businessName: business.name,
  }).from(contractors)
    .innerJoin(business, eq(business.id, contractors.businessId))
    .where(and(
      eq(contractors.id, contractorId),
      eq(contractors.ownerUserId, ownerUserId),
      eq(contractors.businessId, businessId),
    )).limit(1);
  if (!row || !row.email.trim() || !contractorMayHoldPortalAccess(row.engagementStatus)) throw new Error("not_found");
  return { ...row, businessId };
}

async function ownedInvite(database: Database, ownerUserId: string, inviteId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const [row] = await database.select().from(contractorInvites).where(and(
    eq(contractorInvites.id, inviteId),
    eq(contractorInvites.ownerUserId, ownerUserId),
    eq(contractorInvites.businessId, businessId),
  )).limit(1);
  if (!row) throw new Error("not_found");
  const [context] = await database.select({
    email: contractors.email,
    engagementStatus: contractors.engagementStatus,
    businessName: business.name,
  }).from(contractors).innerJoin(business, eq(business.id, contractors.businessId)).where(and(
    eq(contractors.id, row.contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  if (!context) throw new Error("not_found");
  return { row, context: { ...context, businessId } };
}

export async function listInvites(database: Database, ownerUserId: string, now = new Date()): Promise<InviteResource[]> {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const rows = await database.select().from(contractorInvites).where(and(
    eq(contractorInvites.ownerUserId, ownerUserId),
    eq(contractorInvites.businessId, businessId),
  ));
  return rows.map((row) => toResource(row, now));
}

export async function createInvite(database: Database, ownerUserId: string, contractorId: string, now = new Date()): Promise<InviteDelivery> {
  const context = await ownerContext(database, ownerUserId, contractorId);
  const [existing] = await database.select({ id: contractorInvites.id }).from(contractorInvites).where(and(
    eq(contractorInvites.ownerUserId, ownerUserId), eq(contractorInvites.businessId, context.businessId), eq(contractorInvites.contractorId, contractorId),
  )).limit(1);
  if (existing) throw new Error("invite_exists");
  const rawToken = createInviteToken();
  const timestamp = now;
  const tokenDigest = await hashInviteToken(rawToken);
  const invitedEmail = normalizeEmail(context.email);
  const expiresAt = inviteExpiryFrom(now);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);
  const row: typeof contractorInvites.$inferInsert = {
    id: crypto.randomUUID(), ownerUserId, businessId: context.businessId, contractorId,
    invitedEmail, tokenDigest, status: "pending",
    expiresAt, acceptedByUserId: null, acceptedAt: null, acceptanceNonce: null, revokedAt: null,
    createdAt: timestamp, updatedAt: timestamp,
  };
  const insertedInvite = database.select({ value: sql<number>`1` }).from(contractorInvites).where(and(
    eq(contractorInvites.id, row.id), eq(contractorInvites.ownerUserId, ownerUserId), eq(contractorInvites.businessId, context.businessId),
    eq(contractorInvites.contractorId, contractorId), eq(contractorInvites.tokenDigest, tokenDigest), eq(contractorInvites.status, "pending"),
  ));
  try {
    const results = await database.batch([
      database.insert(contractorInvites).select(database.select({
        id: sql<string>`${row.id}`.as("id"),
        ownerUserId: contractors.ownerUserId,
        businessId: contractors.businessId,
        createdAt: sql<Date>`${nowSeconds}`.as("created_at"),
        updatedAt: sql<Date>`${nowSeconds}`.as("updated_at"),
        contractorId: contractors.id,
        invitedEmail: sql<string>`${invitedEmail}`.as("invited_email"),
        tokenDigest: sql<string>`${tokenDigest}`.as("token_digest"),
        status: sql<"pending">`'pending'`.as("status"),
        expiresAt: sql<Date>`${expiresAtSeconds}`.as("expires_at"),
        acceptedByUserId: sql<string | null>`NULL`.as("accepted_by_user_id"),
        acceptedAt: sql<Date | null>`NULL`.as("accepted_at"),
        acceptanceNonce: sql<string | null>`NULL`.as("acceptance_nonce"),
        revokedAt: sql<Date | null>`NULL`.as("revoked_at"),
      }).from(contractors).where(and(
        eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.businessId, context.businessId),
        eq(contractors.email, context.email), eq(contractors.engagementStatus, context.engagementStatus),
        inArray(contractors.engagementStatus, ["invited", "active"]),
      ))),
      database.update(contractors).set({ engagementStatus: "invited", active: true, updatedAt: timestamp }).where(and(
        eq(contractors.id, contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.businessId, context.businessId),
        inArray(contractors.engagementStatus, ["invited", "active"]), exists(insertedInvite),
      )),
    ]);
    for (const result of results) requireSingleChange(result, "not_found");
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("invite_exists");
    throw error;
  }
  return { ...toResource(row as InviteRow, now), rawToken, invitedEmail: row.invitedEmail, businessName: context.businessName };
}

export async function resendInvite(database: Database, ownerUserId: string, inviteId: string, now = new Date()): Promise<InviteDelivery> {
  const { row, context } = await ownedInvite(database, ownerUserId, inviteId);
  assertInviteCanResend(row.status, row.expiresAt, now);
  if (!context.email.trim() || !contractorMayHoldPortalAccess(context.engagementStatus)) throw new Error("not_found");
  const rawToken = createInviteToken();
  const expiresAt = inviteExpiryFrom(now);
  const invitedEmail = normalizeEmail(context.email);
  const unchangedContractor = database.select({ value: sql<number>`1` }).from(contractors).where(and(
    eq(contractors.id, row.contractorId), eq(contractors.ownerUserId, ownerUserId), eq(contractors.businessId, context.businessId),
    eq(contractors.email, context.email), eq(contractors.engagementStatus, context.engagementStatus),
    inArray(contractors.engagementStatus, ["invited", "active"]),
  ));
  const [result] = await database.batch([database.update(contractorInvites).set({ tokenDigest: await hashInviteToken(rawToken), invitedEmail, status: "pending", expiresAt, acceptedByUserId: null, acceptedAt: null, acceptanceNonce: null, revokedAt: null, updatedAt: now }).where(and(
    eq(contractorInvites.id, inviteId), eq(contractorInvites.ownerUserId, ownerUserId), eq(contractorInvites.businessId, context.businessId),
    eq(contractorInvites.tokenDigest, row.tokenDigest), eq(contractorInvites.status, row.status), eq(contractorInvites.expiresAt, row.expiresAt),
    exists(unchangedContractor),
  ))]);
  requireSingleChange(result, "not_found");
  return { id: row.id, contractorId: row.contractorId, status: "pending", expiresAt: expiresAt.toISOString(), rawToken, invitedEmail, businessName: context.businessName };
}

export async function revokeInvite(database: Database, ownerUserId: string, inviteId: string, now = new Date()): Promise<InviteResource> {
  const { row, context } = await ownedInvite(database, ownerUserId, inviteId);
  assertInviteCanRevoke(row.status, row.expiresAt, now);
  const [result] = await database.batch([database.update(contractorInvites).set({ status: "revoked", revokedAt: now, updatedAt: now }).where(and(
    eq(contractorInvites.id, inviteId), eq(contractorInvites.ownerUserId, ownerUserId), eq(contractorInvites.businessId, context.businessId),
    eq(contractorInvites.tokenDigest, row.tokenDigest), eq(contractorInvites.status, row.status), eq(contractorInvites.expiresAt, row.expiresAt),
    gt(contractorInvites.expiresAt, now),
  ))]);
  requireSingleChange(result, "not_found");
  return { id: row.id, contractorId: row.contractorId, status: "revoked", expiresAt: row.expiresAt.toISOString() };
}

async function inviteByRawToken(database: Database, rawToken: string): Promise<{ row: InviteRow; digest: string }> {
  if (!validInviteTokenShape(rawToken)) throw new Error("invite_unavailable");
  const digest = await hashInviteToken(rawToken);
  const [row] = await database.select().from(contractorInvites).where(eq(contractorInvites.tokenDigest, digest)).limit(1);
  if (!row) throw new Error("invite_unavailable");
  return { row, digest };
}

export async function inspectInvite(database: Database, rawToken: string, now = new Date()) {
  const { row } = await inviteByRawToken(database, rawToken);
  if (effectiveInviteStatus(row.status, row.expiresAt, now) !== "pending") throw new Error("invite_unavailable");
  const [workspace] = await database.select({ name: business.name }).from(business).where(eq(business.id, row.businessId)).limit(1);
  if (!workspace) throw new Error("invite_unavailable");
  return { invitedEmail: row.invitedEmail, businessName: workspace.name, expiresAt: row.expiresAt.toISOString() };
}

export async function acceptInvite(database: Database, rawToken: string, user: { id: string; email: string }, now = new Date()): Promise<void> {
  const { row, digest } = await inviteByRawToken(database, rawToken);
  assertInviteCanAccept({ status: row.status, expiresAt: row.expiresAt, invitedEmail: row.invitedEmail, userEmail: user.email }, now);
  const [contractor] = await database.select({ id: contractors.id, engagementStatus: contractors.engagementStatus }).from(contractors).where(and(
    eq(contractors.id, row.contractorId), eq(contractors.ownerUserId, row.ownerUserId), eq(contractors.businessId, row.businessId),
  )).limit(1);
  if (!contractor || !contractorMayHoldPortalAccess(contractor.engagementStatus)) throw new Error("invite_unavailable");
  const acceptedEmail = normalizeEmail(user.email);
  const acceptanceNonce = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const eligibleContractor = database.select({ value: sql<number>`1` }).from(contractors).where(and(
    eq(contractors.id, contractorInvites.contractorId),
    eq(contractors.ownerUserId, contractorInvites.ownerUserId),
    eq(contractors.businessId, contractorInvites.businessId),
    inArray(contractors.engagementStatus, ["invited", "active"]),
  ));
  const claimedInvite = and(
    eq(contractorInvites.id, row.id),
    eq(contractorInvites.ownerUserId, row.ownerUserId),
    eq(contractorInvites.businessId, row.businessId),
    eq(contractorInvites.contractorId, row.contractorId),
    eq(contractorInvites.tokenDigest, digest),
    eq(contractorInvites.status, "accepted"),
    eq(contractorInvites.invitedEmail, acceptedEmail),
    eq(contractorInvites.acceptedByUserId, user.id),
    eq(contractorInvites.acceptanceNonce, acceptanceNonce),
  );
  try {
    const results = await database.batch([
      database.update(contractorInvites).set({ status: "accepted", acceptedByUserId: user.id, acceptedAt: now, acceptanceNonce, updatedAt: now }).where(and(
        eq(contractorInvites.id, row.id), eq(contractorInvites.ownerUserId, row.ownerUserId), eq(contractorInvites.businessId, row.businessId), eq(contractorInvites.contractorId, row.contractorId),
        eq(contractorInvites.tokenDigest, digest), eq(contractorInvites.status, "pending"), gt(contractorInvites.expiresAt, now), eq(contractorInvites.invitedEmail, acceptedEmail), exists(eligibleContractor),
      )),
      database.insert(contractorUsers).select(database.select({
        id: sql<string>`${linkId}`.as("id"),
        ownerUserId: contractorInvites.ownerUserId,
        businessId: contractorInvites.businessId,
        createdAt: sql<Date>`${nowSeconds}`.as("created_at"),
        updatedAt: sql<Date>`${nowSeconds}`.as("updated_at"),
        contractorId: contractorInvites.contractorId,
        userId: sql<string>`${user.id}`.as("user_id"),
      }).from(contractorInvites).where(claimedInvite)),
      database.update(contractors).set({ engagementStatus: "active", active: true, updatedAt: now }).where(and(
        eq(contractors.id, row.contractorId), eq(contractors.ownerUserId, row.ownerUserId), eq(contractors.businessId, row.businessId),
        exists(database.select({ value: sql<number>`1` }).from(contractorInvites).where(claimedInvite)),
        exists(database.select({ value: sql<number>`1` }).from(contractorUsers).where(and(
          eq(contractorUsers.ownerUserId, row.ownerUserId), eq(contractorUsers.businessId, row.businessId), eq(contractorUsers.contractorId, row.contractorId), eq(contractorUsers.userId, user.id),
        ))),
      )),
      database.update(contractorInvites).set({ acceptanceNonce: null }).where(claimedInvite),
    ]);
    for (const result of results) requireSingleChange(result);
  } catch (error) {
    if (isUniqueConstraintError(error) || (error instanceof Error && error.message === "invite_unavailable")) throw new Error("invite_unavailable");
    throw error;
  }
}

export async function accountRole(database: Database, userId: string): Promise<"owner" | "contractor" | "unassigned"> {
  const ownerBusinessId = await ownerBusinessIdOrNull(database, userId);
  if (ownerBusinessId) return "owner";
  const [link] = await database.select({ id: contractorUsers.id }).from(contractorUsers).innerJoin(contractors, and(
    eq(contractors.id, contractorUsers.contractorId),
    eq(contractors.ownerUserId, contractorUsers.ownerUserId),
    eq(contractors.businessId, contractorUsers.businessId),
  )).where(and(eq(contractorUsers.userId, userId), inArray(contractors.engagementStatus, ["invited", "active"]))).limit(1);
  return link ? "contractor" : "unassigned";
}
