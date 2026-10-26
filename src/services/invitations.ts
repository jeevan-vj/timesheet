import { and, desc, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { business, contractorAccount, contractorInvitation, contractors } from "@/db/schema";
import { contractorFirstName, invitationEmail } from "@/lib/email-templates/invitation";
import { InvitationExistsError } from "@/lib/invitation-errors";
import { generateInvitationToken, invitationAcceptUrl, invitationTokenDigest } from "@/lib/invitation-token";
import {
  emptyInvitationView,
  INVITATION_TTL_MS,
  resendTooSoon,
  snapshotEmail,
  toInvitationView,
  type InvitationDelivery,
  type InvitationIssued,
  type InvitationView,
} from "@/lib/invitation-view";
import { contractorMayHoldPortalAccess, type EngagementStatus } from "@/lib/contractor-lifecycle";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { requireOwnerBusinessId } from "@/lib/business";
import { sendEmail, type SendEmailInput, type SendEmailResult } from "@/lib/mailer";

type Database = typeof db;

type InvitationRow = typeof contractorInvitation.$inferSelect;

export type InvitationDeps = {
  now?: () => Date;
  createId?: () => string;
  createToken?: () => string;
  sendEmail?: (input: SendEmailInput) => Promise<SendEmailResult>;
};

type InviteCtx = {
  database: Database;
  ownerUserId: string;
  businessId: string;
  businessName: string;
  contactEmail: string;
  contractor: { id: string; name: string; email: string; engagementStatus: EngagementStatus };
  publicUrl: string;
  now: () => Date;
  createId: () => string;
  createToken: () => string;
  sendEmail: (input: SendEmailInput) => Promise<SendEmailResult>;
};

function depsOf(deps: InvitationDeps): Omit<InviteCtx, "database" | "ownerUserId" | "businessId" | "businessName" | "contactEmail" | "contractor" | "publicUrl"> {
  return {
    now: deps.now ?? (() => new Date()),
    createId: deps.createId ?? (() => crypto.randomUUID()),
    createToken: deps.createToken ?? generateInvitationToken,
    sendEmail: deps.sendEmail ?? sendEmail,
  };
}

export async function getContractorInvitation(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  deps: InvitationDeps = {},
): Promise<InvitationView> {
  const ctx = await loadInviteContext(database, ownerUserId, contractorId, "https://invitation.invalid", deps);
  const pending = await findPending(ctx);
  if (pending) return toInvitationView(pending, ctx.now());
  const latest = await findLatest(ctx);
  if (!latest) return emptyInvitationView();
  return toInvitationView(latest, ctx.now());
}

export async function createContractorInvitation(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  publicUrl: string,
  deps: InvitationDeps = {},
): Promise<InvitationIssued> {
  const ctx = await loadInviteContext(database, ownerUserId, contractorId, publicUrl, deps);
  assertCanInvite(ctx.contractor);
  await assertNotLinked(ctx);
  const pending = await findPending(ctx);
  if (pending) throw new InvitationExistsError(toInvitationView(pending, ctx.now()));
  const token = ctx.createToken();
  const row = await insertInvite(ctx, token);
  return deliverAndView(ctx, row, token);
}

export async function resendContractorInvitation(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  publicUrl: string,
  deps: InvitationDeps = {},
): Promise<InvitationIssued> {
  const ctx = await loadInviteContext(database, ownerUserId, contractorId, publicUrl, deps);
  assertCanInvite(ctx.contractor);
  const pending = requirePendingResend(await findPending(ctx), ctx.now());
  const token = ctx.createToken();
  const row = await rotateInvite(ctx, pending, token);
  return deliverAndView(ctx, row, token);
}

export async function revokeContractorInvitation(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  deps: InvitationDeps = {},
): Promise<{ invitation: InvitationView }> {
  const ctx = await loadInviteContext(database, ownerUserId, contractorId, "https://invitation.invalid", deps);
  const pending = await findPending(ctx);
  if (!pending) throw new Error("invitation_not_pending");
  const clock = ctx.now();
  await ctx.database.update(contractorInvitation).set({
    status: "revoked",
    revokedAt: clock,
    updatedAt: clock,
  }).where(pendingWhere(ctx, pending.id));
  return { invitation: toInvitationView({ ...pending, status: "revoked" }, clock) };
}

async function loadInviteContext(
  database: Database,
  ownerUserId: string,
  contractorId: string,
  publicUrl: string,
  deps: InvitationDeps,
): Promise<InviteCtx> {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const profile = await loadBusiness(database, businessId);
  const contractor = await loadContractor(database, ownerUserId, businessId, contractorId);
  return { database, ownerUserId, businessId, ...profile, contractor, publicUrl, ...depsOf(deps) };
}

async function loadBusiness(database: Database, businessId: string): Promise<{ businessName: string; contactEmail: string }> {
  const [row] = await database.select({
    businessName: business.name,
    contactEmail: business.contactEmail,
  }).from(business).where(eq(business.id, businessId)).limit(1);
  if (!row) throw new Error("not_found");
  return row;
}

async function loadContractor(
  database: Database,
  ownerUserId: string,
  businessId: string,
  contractorId: string,
): Promise<InviteCtx["contractor"]> {
  const [row] = await database.select({
    id: contractors.id,
    name: contractors.name,
    email: contractors.email,
    engagementStatus: contractors.engagementStatus,
  }).from(contractors).where(and(
    eq(contractors.id, contractorId),
    eq(contractors.ownerUserId, ownerUserId),
    eq(contractors.businessId, businessId),
  )).limit(1);
  if (!row) throw new Error("not_found");
  return row;
}

function assertCanInvite(contractor: InviteCtx["contractor"]): void {
  if (!contractorMayHoldPortalAccess(contractor.engagementStatus)) throw new Error("not_found");
  if (snapshotEmail(contractor.email) === "") throw new Error("contractor_email_required");
}

async function assertNotLinked(ctx: InviteCtx): Promise<void> {
  const [row] = await ctx.database.select({ id: contractorAccount.id }).from(contractorAccount).where(
    eq(contractorAccount.contractorId, ctx.contractor.id),
  ).limit(1);
  if (row) throw new Error("already_linked");
}

function ownedInvite(ctx: InviteCtx) {
  return and(
    eq(contractorInvitation.contractorId, ctx.contractor.id),
    eq(contractorInvitation.ownerUserId, ctx.ownerUserId),
    eq(contractorInvitation.businessId, ctx.businessId),
  );
}

async function findPending(ctx: InviteCtx): Promise<InvitationRow | null> {
  const [row] = await ctx.database.select().from(contractorInvitation).where(and(
    ownedInvite(ctx),
    eq(contractorInvitation.status, "pending"),
  )).limit(1);
  return row ?? null;
}

async function findLatest(ctx: InviteCtx): Promise<InvitationRow | null> {
  const [row] = await ctx.database.select().from(contractorInvitation).where(ownedInvite(ctx)).orderBy(
    desc(contractorInvitation.updatedAt),
  ).limit(1);
  return row ?? null;
}

async function insertInvite(ctx: InviteCtx, token: string): Promise<InvitationRow> {
  const row = await buildInvite(ctx, token, 1);
  try {
    await ctx.database.insert(contractorInvitation).values(row);
  } catch (error) {
    await rethrowPendingConflict(ctx, error);
  }
  await markInvited(ctx);
  return row;
}

async function buildInvite(ctx: InviteCtx, token: string, sendCount: number): Promise<InvitationRow> {
  const clock = ctx.now();
  return {
    id: ctx.createId(),
    businessId: ctx.businessId,
    ownerUserId: ctx.ownerUserId,
    contractorId: ctx.contractor.id,
    email: snapshotEmail(ctx.contractor.email),
    tokenDigest: await invitationTokenDigest(token),
    status: "pending",
    expiresAt: new Date(clock.getTime() + INVITATION_TTL_MS),
    sendCount,
    lastSentAt: clock,
    lastDelivery: "link_only",
    acceptedAt: null,
    acceptedUserId: null,
    revokedAt: null,
    createdByUserId: ctx.ownerUserId,
    createdAt: clock,
    updatedAt: clock,
  };
}

async function rethrowPendingConflict(ctx: InviteCtx, error: unknown): Promise<never> {
  if (!isUniqueConstraintError(error)) throw error;
  const pending = await findPending(ctx);
  if (pending) throw new InvitationExistsError(toInvitationView(pending, ctx.now()));
  throw error;
}

async function markInvited(ctx: InviteCtx): Promise<void> {
  await ctx.database.update(contractors).set({
    engagementStatus: "invited",
    active: true,
    updatedAt: ctx.now(),
  }).where(and(
    eq(contractors.id, ctx.contractor.id),
    eq(contractors.ownerUserId, ctx.ownerUserId),
    eq(contractors.businessId, ctx.businessId),
  ));
}

function requirePendingResend(pending: InvitationRow | null, now: Date): InvitationRow {
  if (!pending) throw new Error("invitation_not_pending");
  if (resendTooSoon(pending.lastSentAt, now)) throw new Error("resend_too_soon");
  return pending;
}

async function rotateInvite(ctx: InviteCtx, pending: InvitationRow, token: string): Promise<InvitationRow> {
  const clock = ctx.now();
  const next: InvitationRow = {
    ...pending,
    email: snapshotEmail(ctx.contractor.email),
    tokenDigest: await invitationTokenDigest(token),
    expiresAt: new Date(clock.getTime() + INVITATION_TTL_MS),
    sendCount: pending.sendCount + 1,
    lastSentAt: clock,
    lastDelivery: "link_only",
    updatedAt: clock,
  };
  const [updated] = await ctx.database.update(contractorInvitation).set({
    email: next.email,
    tokenDigest: next.tokenDigest,
    expiresAt: next.expiresAt,
    sendCount: next.sendCount,
    lastSentAt: next.lastSentAt,
    lastDelivery: next.lastDelivery,
    updatedAt: next.updatedAt,
  }).where(and(
    pendingWhere(ctx, pending.id),
    eq(contractorInvitation.sendCount, pending.sendCount),
  )).returning({ id: contractorInvitation.id });
  if (!updated) throw new Error("invitation_conflict");
  return next;
}

function pendingWhere(ctx: InviteCtx, invitationId: string) {
  return and(
    eq(contractorInvitation.id, invitationId),
    eq(contractorInvitation.ownerUserId, ctx.ownerUserId),
    eq(contractorInvitation.businessId, ctx.businessId),
    eq(contractorInvitation.status, "pending"),
  );
}

async function deliverAndView(ctx: InviteCtx, row: InvitationRow, token: string): Promise<InvitationIssued> {
  const delivered = await deliverInvitation(ctx, row, token);
  await saveDelivery(ctx, row.id, delivered.delivery);
  return {
    invitation: toInvitationView({ ...row, lastDelivery: delivered.delivery }, ctx.now()),
    delivery: delivered.delivery,
    inviteLink: delivered.inviteLink,
  };
}

async function deliverInvitation(
  ctx: InviteCtx,
  row: InvitationRow,
  token: string,
): Promise<{ delivery: InvitationDelivery; inviteLink: string }> {
  const inviteLink = invitationAcceptUrl(ctx.publicUrl, token);
  const message = invitationEmail({
    businessName: ctx.businessName,
    firstName: contractorFirstName(ctx.contractor.name),
    inviteLink,
  });
  const result = await ctx.sendEmail({
    to: row.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    idempotencyKey: `invite/${row.id}/${row.sendCount}`,
    replyTo: ctx.contactEmail,
    kind: "invitation",
  });
  return { delivery: deliveryFromResult(result), inviteLink };
}

function deliveryFromResult(result: SendEmailResult): InvitationDelivery {
  if (result.status === "sent") return "email";
  if (result.status === "not_configured") return "link_only";
  return "email_failed";
}

async function saveDelivery(ctx: InviteCtx, invitationId: string, delivery: InvitationDelivery): Promise<void> {
  await ctx.database.update(contractorInvitation).set({
    lastDelivery: delivery,
    updatedAt: ctx.now(),
  }).where(and(
    eq(contractorInvitation.id, invitationId),
    eq(contractorInvitation.ownerUserId, ctx.ownerUserId),
    eq(contractorInvitation.businessId, ctx.businessId),
  ));
}
