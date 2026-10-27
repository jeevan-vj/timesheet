import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/db/client";
import { account, business, contractorAccount, contractorInvitation, contractors, session, user } from "@/db/schema";
import { contractorMayHoldPortalAccess, type EngagementStatus } from "@/lib/contractor-lifecycle";
import { CREDENTIAL_ISSUER, CREDENTIAL_PROVIDER, hashCredentialPassword, verifyCredentialPassword } from "@/lib/credential-account";
import { isUniqueConstraintError } from "@/lib/db-errors";
import {
  classifyStoredInvite,
  passwordProblem,
  previewMode,
  type AcceptBody,
  type ClosedInviteState,
  type InviteMode,
} from "@/lib/invite-public";
import { invitationTokenDigest } from "@/lib/invitation-token";
import { asDate, snapshotEmail } from "@/lib/invitation-view";
import { SESSION_SECONDS, sessionSetCookie } from "@/lib/session-cookie";

type Database = typeof db;
type InvitationRow = typeof contractorInvitation.$inferSelect;

type InviteCore = {
  id: string;
  businessId: string;
  ownerUserId: string;
  contractorId: string;
  email: string;
  tokenDigest: string;
  contractorName: string;
  businessName: string;
};

type Target = { name: string; businessName: string; eligible: boolean; emailAligned: boolean };

type Loaded =
  | { kind: "unknown" }
  | { kind: "expired" | "revoked" }
  | { kind: "used"; invite: InviteCore; acceptedUserId: string | null }
  | { kind: "pending"; invite: InviteCore; user: { id: string } | null };

export type AcceptInput = AcceptBody & {
  session: { id: string; email: string } | null;
  secret: string;
  baseURL: string;
  secureCookies: boolean;
  ipAddress: string;
  userAgent: string;
};

export type AcceptDeps = {
  now?: () => Date;
  createId?: () => string;
  hashPassword?: (password: string) => Promise<string>;
  verifyPassword?: (hash: string, password: string) => Promise<boolean>;
};

export type AcceptResult =
  | { ok: true; setCookie: string | null }
  | { ok: false; error: ClosedInviteState | "email_mismatch" | "password_mismatch" | "weak_password" | "account_mismatch" | "sign_in_required" };

export type PreviewResult =
  | { state: ClosedInviteState }
  | { state: "ready"; mode: Exclude<InviteMode, "mismatch">; businessName: string; email: string }
  | { state: "ready"; mode: "mismatch"; businessName: string; email: string; signedInEmail: string };

type Clock = { now: Date; seconds: number };

export async function previewInvitation(
  database: Database,
  input: { token: string; session: { email: string } | null },
  deps: AcceptDeps = {},
): Promise<PreviewResult> {
  const loaded = await loadInvitation(database, input.token, clock(deps).now);
  if (loaded.kind !== "pending") return { state: loaded.kind };
  return readyPreview(loaded.invite, input.session, loaded.user !== null);
}

export async function acceptInvitation(database: Database, input: AcceptInput, deps: AcceptDeps = {}): Promise<AcceptResult> {
  const timed = clock(deps);
  const loaded = await loadInvitation(database, input.token, timed.now);
  if (loaded.kind !== "pending") return acceptClosed(database, loaded, input, deps, timed);
  if (snapshotEmail(input.email) !== snapshotEmail(loaded.invite.email)) return { ok: false, error: "email_mismatch" };
  const mode = previewMode({ userExists: loaded.user !== null, sessionEmail: input.session?.email ?? null, inviteEmail: loaded.invite.email });
  if (mode === "mismatch") return { ok: false, error: "account_mismatch" };
  if (mode === "accept") return linkSignedIn(database, loaded, input, deps, timed);
  if (mode === "sign_in") return signInOrRepair(database, loaded, input, deps, timed);
  return createAccount(database, loaded, input, deps, timed);
}

function readyPreview(invite: InviteCore, sessionUser: { email: string } | null, userExists: boolean): PreviewResult {
  const mode = previewMode({ userExists, sessionEmail: sessionUser?.email ?? null, inviteEmail: invite.email });
  const email = snapshotEmail(invite.email);
  if (mode === "mismatch") {
    return { state: "ready", mode, businessName: invite.businessName, email, signedInEmail: snapshotEmail(sessionUser?.email ?? "") };
  }
  return { state: "ready", mode, businessName: invite.businessName, email };
}

function clock(deps: AcceptDeps): Clock {
  const now = (deps.now ?? (() => new Date()))();
  return { now, seconds: Math.floor(now.getTime() / 1000) };
}

function nextId(deps: AcceptDeps): string {
  return (deps.createId ?? (() => crypto.randomUUID()))();
}

async function acceptClosed(database: Database, loaded: Exclude<Loaded, { kind: "pending" }>, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  if (loaded.kind !== "used") return { ok: false, error: loaded.kind };
  return resumeUsed(database, loaded, input, deps, timed);
}

async function createAccount(database: Database, loaded: Extract<Loaded, { kind: "pending" }>, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  const problem = passwordProblem(input.password, input.passwordConfirm);
  if (problem) return { ok: false, error: problem };
  const hash = await (deps.hashPassword ?? hashCredentialPassword)(input.password ?? "");
  const userId = nextId(deps);
  const sessionToken = nextId(deps);
  const outcome = await commitWrites(database, newAccountWrites(database, loaded.invite, input, userId, hash, sessionToken, deps, timed));
  if (outcome === "conflict") return recoverConflict(database, input, deps, timed);
  return finishCreated(database, loaded.invite, userId, sessionToken, input, timed.now);
}

function newAccountWrites(database: Database, invite: InviteCore, input: AcceptInput, userId: string, hash: string, sessionToken: string, deps: AcceptDeps, timed: Clock) {
  return [
    userInsert(database, invite, userId, timed.seconds),
    credentialInsert(database, userId, nextId(deps), hash, timed.seconds),
    linkInsert(database, invite, userId, nextId(deps), timed.seconds),
    acceptUpdate(database, invite, userId, timed),
    statusUpdate(database, invite, userId, timed.now),
    sessionInsert(database, invite, userId, nextId(deps), sessionToken, input, timed.seconds),
  ];
}

async function signInOrRepair(database: Database, loaded: Extract<Loaded, { kind: "pending" }>, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  if (!loaded.user) return { ok: false, error: "sign_in_required" };
  if (await credentialPassword(database, loaded.user.id)) return { ok: false, error: "sign_in_required" };
  const problem = passwordProblem(input.password, input.passwordConfirm);
  if (problem) return { ok: false, error: problem };
  if (await otherLink(database, loaded.invite.contractorId, loaded.user.id)) return { ok: false, error: "used" };
  const hash = await (deps.hashPassword ?? hashCredentialPassword)(input.password ?? "");
  const sessionToken = nextId(deps);
  const outcome = await commitWrites(database, repairWrites(database, loaded.invite, input, loaded.user.id, hash, sessionToken, deps, timed));
  if (outcome === "conflict") return recoverConflict(database, input, deps, timed);
  return finishCreated(database, loaded.invite, loaded.user.id, sessionToken, input, timed.now);
}

function repairWrites(database: Database, invite: InviteCore, input: AcceptInput, userId: string, hash: string, sessionToken: string, deps: AcceptDeps, timed: Clock) {
  return [
    verifyInvitedEmail(database, invite, userId, timed),
    fillMissingPassword(database, userId, hash, timed.now),
    credentialInsert(database, userId, nextId(deps), hash, timed.seconds),
    linkInsert(database, invite, userId, nextId(deps), timed.seconds),
    acceptUpdate(database, invite, userId, timed),
    statusUpdate(database, invite, userId, timed.now),
    sessionInsert(database, invite, userId, nextId(deps), sessionToken, input, timed.seconds),
  ];
}

async function linkSignedIn(database: Database, loaded: Extract<Loaded, { kind: "pending" }>, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  const userId = loaded.user?.id ?? input.session?.id ?? "";
  if (!userId) return { ok: false, error: "sign_in_required" };
  if (await otherLink(database, loaded.invite.contractorId, userId)) return { ok: false, error: "used" };
  const outcome = await commitWrites(database, [
    linkInsert(database, loaded.invite, userId, nextId(deps), timed.seconds),
    acceptUpdate(database, loaded.invite, userId, timed),
    statusUpdate(database, loaded.invite, userId, timed.now),
  ]);
  if (outcome === "conflict") return recoverConflict(database, input, deps, timed);
  if (!(await isLinked(database, loaded.invite, userId))) return reloadClosed(database, input.token, timed.now);
  return { ok: true, setCookie: null };
}

async function resumeUsed(database: Database, loaded: Extract<Loaded, { kind: "used" }>, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  if (snapshotEmail(input.email) !== snapshotEmail(loaded.invite.email) || !loaded.acceptedUserId) return { ok: false, error: "used" };
  if (passwordProblem(input.password, input.passwordConfirm)) return { ok: false, error: "used" };
  if (!(await passwordMatches(database, loaded.acceptedUserId, input.password ?? "", deps))) return { ok: false, error: "used" };
  const sessionToken = nextId(deps);
  await commitWrites(database, [
    database.insert(session).values(sessionValues(nextId(deps), sessionToken, loaded.acceptedUserId, input, timed)),
  ]);
  return cookieResult(database, sessionToken, input);
}

async function finishCreated(database: Database, invite: InviteCore, userId: string, sessionToken: string, input: AcceptInput, now: Date): Promise<AcceptResult> {
  if (!(await isLinked(database, invite, userId))) return reloadClosed(database, invite.tokenDigest, now, true);
  return cookieResult(database, sessionToken, input);
}

async function cookieResult(database: Database, sessionToken: string, input: AcceptInput): Promise<AcceptResult> {
  if (!(await storedSession(database, sessionToken))) return { ok: false, error: "used" };
  const setCookie = await sessionSetCookie({
    token: sessionToken,
    secret: input.secret,
    baseURL: input.baseURL,
    secure: input.secureCookies,
  });
  return { ok: true, setCookie };
}

async function recoverConflict(database: Database, input: AcceptInput, deps: AcceptDeps, timed: Clock): Promise<AcceptResult> {
  const loaded = await loadInvitation(database, input.token, timed.now);
  if (loaded.kind === "used") return resumeUsed(database, loaded, input, deps, timed);
  if (loaded.kind === "pending") return { ok: false, error: "sign_in_required" };
  return { ok: false, error: loaded.kind };
}

async function reloadClosed(database: Database, tokenOrDigest: string, now: Date, digest = false): Promise<AcceptResult> {
  const loaded = digest
    ? await loadByDigest(database, tokenOrDigest, now)
    : await loadInvitation(database, tokenOrDigest, now);
  if (loaded.kind === "pending") return { ok: false, error: "used" };
  return { ok: false, error: loaded.kind };
}

async function loadInvitation(database: Database, token: string, now: Date): Promise<Loaded> {
  return loadByDigest(database, await invitationTokenDigest(token), now);
}

async function loadByDigest(database: Database, digest: string, now: Date): Promise<Loaded> {
  const [row] = await database.select().from(contractorInvitation).where(eq(contractorInvitation.tokenDigest, digest)).limit(1);
  if (!row) return { kind: "unknown" };
  const target = await loadTarget(database, row);
  const kind = classifyStoredInvite({
    status: row.status,
    expiresAt: asDate(row.expiresAt),
    now,
    eligible: target?.eligible ?? false,
    emailAligned: target?.emailAligned ?? false,
  });
  const invite = coreFrom(row, target);
  if (kind === "pending") return { kind, invite, user: await userByEmail(database, row.email) };
  if (kind === "used") return { kind, invite, acceptedUserId: row.acceptedUserId };
  return { kind };
}

async function loadTarget(database: Database, row: InvitationRow): Promise<Target | null> {
  const [contractor] = await database.select({
    name: contractors.name,
    email: contractors.email,
    engagementStatus: contractors.engagementStatus,
  }).from(contractors).where(and(
    eq(contractors.id, row.contractorId),
    eq(contractors.ownerUserId, row.ownerUserId),
    eq(contractors.businessId, row.businessId),
  )).limit(1);
  if (!contractor) return null;
  const [profile] = await database.select({ name: business.name }).from(business).where(eq(business.id, row.businessId)).limit(1);
  if (!profile) return null;
  return {
    name: contractor.name,
    businessName: profile.name,
    eligible: contractorMayHoldPortalAccess(contractor.engagementStatus as EngagementStatus),
    emailAligned: snapshotEmail(contractor.email) === snapshotEmail(row.email),
  };
}

function coreFrom(row: InvitationRow, target: Target | null): InviteCore {
  return {
    id: row.id,
    businessId: row.businessId,
    ownerUserId: row.ownerUserId,
    contractorId: row.contractorId,
    email: row.email,
    tokenDigest: row.tokenDigest,
    contractorName: target?.name || "Contractor",
    businessName: target?.businessName || "",
  };
}

async function userByEmail(database: Database, email: string): Promise<{ id: string } | null> {
  const [row] = await database.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${snapshotEmail(email)}`).limit(1);
  return row ?? null;
}

async function otherLink(database: Database, contractorId: string, userId: string): Promise<boolean> {
  const [row] = await database.select({ userId: contractorAccount.userId }).from(contractorAccount).where(
    eq(contractorAccount.contractorId, contractorId),
  ).limit(1);
  return Boolean(row && row.userId !== userId);
}

async function isLinked(database: Database, invite: InviteCore, userId: string): Promise<boolean> {
  const [link] = await database.select({ userId: contractorAccount.userId }).from(contractorAccount).where(and(
    eq(contractorAccount.contractorId, invite.contractorId),
    eq(contractorAccount.userId, userId),
    eq(contractorAccount.active, 1),
  )).limit(1);
  if (!link) return false;
  const [row] = await database.select({
    status: contractorInvitation.status,
    acceptedUserId: contractorInvitation.acceptedUserId,
  }).from(contractorInvitation).where(eq(contractorInvitation.id, invite.id)).limit(1);
  return row?.status === "accepted" && row.acceptedUserId === userId;
}

async function storedSession(database: Database, token: string): Promise<boolean> {
  const [row] = await database.select({ id: session.id }).from(session).where(eq(session.token, token)).limit(1);
  return Boolean(row);
}

async function credentialPassword(database: Database, userId: string): Promise<string | null> {
  const [row] = await database.select({ password: account.password }).from(account).where(and(
    eq(account.userId, userId),
    eq(account.issuer, CREDENTIAL_ISSUER),
    eq(account.providerId, CREDENTIAL_PROVIDER),
    eq(account.accountId, userId),
  )).limit(1);
  return row?.password ?? null;
}

async function passwordMatches(database: Database, userId: string, password: string, deps: AcceptDeps): Promise<boolean> {
  const hash = await credentialPassword(database, userId);
  if (!hash) return false;
  return (deps.verifyPassword ?? verifyCredentialPassword)(hash, password);
}

async function commitWrites(database: Database, statements: readonly object[]): Promise<"ok" | "conflict"> {
  try {
    await runBatch(database, statements);
    return "ok";
  } catch (error) {
    if (isUniqueConstraintError(error)) return "conflict";
    throw error;
  }
}

async function runBatch(database: Database, statements: readonly object[]): Promise<void> {
  const runner = database as Database & { batch?: (queries: readonly unknown[]) => Promise<unknown> };
  if (typeof runner.batch === "function") {
    await runner.batch(statements);
    return;
  }
  for (const statement of statements) await statement;
}

function pendingFilter(invite: InviteCore, seconds: number) {
  return and(
    eq(contractorInvitation.id, invite.id),
    eq(contractorInvitation.status, "pending"),
    eq(contractorInvitation.tokenDigest, invite.tokenDigest),
    sql`${contractorInvitation.expiresAt} >= ${seconds}`,
  );
}

function userInsert(database: Database, invite: InviteCore, userId: string, seconds: number) {
  return database.insert(user).select(database.select({
    id: sql`${userId}`.as("id"),
    name: sql`${invite.contractorName}`.as("name"),
    email: contractorInvitation.email,
    emailVerified: sql`1`.as("email_verified"),
    image: sql`null`.as("image"),
    createdAt: sql`${seconds}`.as("created_at"),
    updatedAt: sql`${seconds}`.as("updated_at"),
  }).from(contractorInvitation).where(pendingFilter(invite, seconds)));
}

function credentialInsert(database: Database, userId: string, accountId: string, hash: string, seconds: number) {
  return database.insert(account).select(database.select({
    id: sql`${accountId}`.as("id"),
    userId: user.id,
    issuer: sql`${CREDENTIAL_ISSUER}`.as("issuer"),
    accountId: user.id,
    providerId: sql`${CREDENTIAL_PROVIDER}`.as("provider_id"),
    accessToken: sql`null`.as("access_token"),
    refreshToken: sql`null`.as("refresh_token"),
    accessTokenExpiresAt: sql`null`.as("access_token_expires_at"),
    refreshTokenExpiresAt: sql`null`.as("refresh_token_expires_at"),
    scope: sql`null`.as("scope"),
    idToken: sql`null`.as("id_token"),
    password: sql`${hash}`.as("password"),
    createdAt: sql`${seconds}`.as("created_at"),
    updatedAt: sql`${seconds}`.as("updated_at"),
  }).from(user).where(and(
    eq(user.id, userId),
    sql`not exists (select 1 from ${account} where ${account.userId} = ${userId} and ${account.issuer} = ${CREDENTIAL_ISSUER})`,
  )));
}

function verifyInvitedEmail(database: Database, invite: InviteCore, userId: string, timed: Clock) {
  return database.update(user).set({ emailVerified: true, updatedAt: timed.now }).where(and(
    eq(user.id, userId),
    sql`exists (select 1 from ${contractorInvitation} where ${pendingFilter(invite, timed.seconds)})`,
  ));
}

function fillMissingPassword(database: Database, userId: string, hash: string, now: Date) {
  return database.update(account).set({ password: hash, updatedAt: now }).where(and(
    eq(account.userId, userId),
    eq(account.issuer, CREDENTIAL_ISSUER),
    eq(account.accountId, userId),
    sql`${account.password} is null`,
  ));
}

function linkInsert(database: Database, invite: InviteCore, userId: string, linkId: string, seconds: number) {
  return database.insert(contractorAccount).select(database.select({
    id: sql`${linkId}`.as("id"),
    businessId: contractorInvitation.businessId,
    ownerUserId: contractorInvitation.ownerUserId,
    contractorId: contractorInvitation.contractorId,
    userId: sql`${userId}`.as("user_id"),
    invitationId: contractorInvitation.id,
    active: sql`1`.as("active"),
    revokedAt: sql`null`.as("revoked_at"),
    createdAt: sql`${seconds}`.as("created_at"),
    updatedAt: sql`${seconds}`.as("updated_at"),
  }).from(contractorInvitation).where(and(
    pendingFilter(invite, seconds),
    sql`not exists (
      select 1 from ${contractorAccount}
      where ${contractorAccount.contractorId} = ${contractorInvitation.contractorId}
        and ${contractorAccount.userId} <> ${userId}
    )`,
  ))).onConflictDoNothing({ target: contractorAccount.contractorId });
}

function acceptUpdate(database: Database, invite: InviteCore, userId: string, timed: Clock) {
  return database.update(contractorInvitation).set({
    status: "accepted",
    acceptedAt: timed.now,
    acceptedUserId: userId,
    updatedAt: timed.now,
  }).where(and(
    pendingFilter(invite, timed.seconds),
    sql`exists (
      select 1 from ${contractorAccount}
      where ${contractorAccount.contractorId} = ${invite.contractorId}
        and ${contractorAccount.userId} = ${userId}
    )`,
  ));
}

function statusUpdate(database: Database, invite: InviteCore, userId: string, now: Date) {
  return database.update(contractors).set({
    engagementStatus: "active",
    active: true,
    updatedAt: now,
  }).where(and(
    eq(contractors.id, invite.contractorId),
    eq(contractors.ownerUserId, invite.ownerUserId),
    eq(contractors.businessId, invite.businessId),
    eq(contractors.engagementStatus, "invited"),
    sql`exists (
      select 1 from ${contractorInvitation}
      where ${contractorInvitation.id} = ${invite.id}
        and ${contractorInvitation.status} = 'accepted'
        and ${contractorInvitation.acceptedUserId} = ${userId}
    )`,
  ));
}

function sessionInsert(database: Database, invite: InviteCore, userId: string, sessionId: string, sessionToken: string, input: AcceptInput, seconds: number) {
  const values = sessionValues(sessionId, sessionToken, userId, input, { now: new Date(seconds * 1000), seconds });
  return database.insert(session).select(database.select({
    id: sql`${values.id}`.as("id"),
    userId: user.id,
    token: sql`${values.token}`.as("token"),
    expiresAt: sql`${seconds + SESSION_SECONDS}`.as("expires_at"),
    ipAddress: sql`${values.ipAddress}`.as("ip_address"),
    userAgent: sql`${values.userAgent}`.as("user_agent"),
    createdAt: sql`${seconds}`.as("created_at"),
    updatedAt: sql`${seconds}`.as("updated_at"),
  }).from(user).where(and(
    eq(user.id, userId),
    sql`exists (
      select 1 from ${contractorInvitation}
      where ${contractorInvitation.id} = ${invite.id}
        and ${contractorInvitation.status} = 'accepted'
        and ${contractorInvitation.acceptedUserId} = ${userId}
    )`,
  )));
}

function sessionValues(sessionId: string, sessionToken: string, userId: string, input: AcceptInput, timed: Clock) {
  return {
    id: sessionId,
    userId,
    token: sessionToken,
    expiresAt: new Date((timed.seconds + SESSION_SECONDS) * 1000),
    ipAddress: input.ipAddress.trim().slice(0, 64) || null,
    userAgent: input.userAgent.trim().slice(0, 512) || null,
    createdAt: timed.now,
    updatedAt: timed.now,
  };
}
