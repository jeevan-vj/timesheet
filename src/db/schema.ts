import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("session_user_id_idx").on(t.userId)]);

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  issuer: text("issuer").notNull(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
  scope: text("scope"),
  idToken: text("id_token"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("account_user_id_idx").on(t.userId), uniqueIndex("account_issuer_account_id_uq").on(t.issuer, t.accountId)]);

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("verification_identifier_idx").on(t.identifier)]);

export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
}, (t) => [uniqueIndex("rate_limit_key_uq").on(t.key)]);

export const business = sqliteTable("business", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  nzbn: text("nzbn").notNull().default(""),
  address: text("address").notNull().default(""),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull().default(""),
  timezone: text("timezone").notNull().default("Pacific/Auckland"),
  currency: text("currency").notNull().default("NZD"),
  weekStart: text("week_start").notNull().default("monday"),
  onboardingCompletedAt: integer("onboarding_completed_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const businessMember = sqliteTable("business_member", {
  id: text("id").primaryKey(),
  businessId: text("business_id").notNull().references(() => business.id, { onDelete: "restrict" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (t) => [
  uniqueIndex("business_member_business_user_uq").on(t.businessId, t.userId),
  index("business_member_user_id_idx").on(t.userId),
  uniqueIndex("business_member_active_user_uq").on(t.userId).where(sql`${t.active} = 1`),
]);

const ownedFields = {
  ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  businessId: text("business_id").notNull().references(() => business.id, { onDelete: "restrict" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

export const sites = sqliteTable("site", {
  id: text("id").primaryKey(),
  ...ownedFields,
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [index("site_owner_idx").on(t.ownerUserId), uniqueIndex("site_owner_name_uq").on(t.ownerUserId, t.name)]);

export const contractors = sqliteTable("contractor", {
  id: text("id").primaryKey(),
  ...ownedFields,
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  defaultRateCents: integer("default_rate_cents").notNull(),
  currency: text("currency").notNull().default("NZD"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  preferredName: text("preferred_name").notNull().default(""),
  startDate: text("start_date"),
  engagementStatus: text("engagement_status").notNull().default("active").$type<"draft" | "invited" | "active" | "suspended" | "archived">(),
  gstRegistered: integer("gst_registered", { mode: "boolean" }).notNull().default(false),
  gstNumber: text("gst_number").notNull().default(""),
  internalNotes: text("internal_notes").notNull().default(""),
  emergencyContactName: text("emergency_contact_name").notNull().default(""),
  emergencyContactPhone: text("emergency_contact_phone").notNull().default(""),
}, (t) => [index("contractor_owner_idx").on(t.ownerUserId), uniqueIndex("contractor_owner_name_uq").on(t.ownerUserId, t.name)]);

export const contractorInvites = sqliteTable("contractor_invite", {
  id: text("id").primaryKey(),
  ...ownedFields,
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  invitedEmail: text("invited_email").notNull(),
  tokenDigest: text("token_digest").notNull(),
  status: text("status").notNull().default("pending").$type<"pending" | "accepted" | "expired" | "revoked">(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  acceptedByUserId: text("accepted_by_user_id").references(() => user.id, { onDelete: "restrict" }),
  acceptedAt: integer("accepted_at", { mode: "timestamp" }),
  acceptanceNonce: text("acceptance_nonce"),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
}, (t) => [
  uniqueIndex("contractor_invite_contractor_uq").on(t.businessId, t.contractorId),
  uniqueIndex("contractor_invite_token_digest_uq").on(t.tokenDigest),
  index("contractor_invite_owner_idx").on(t.ownerUserId, t.businessId),
]);

export const contractorUsers = sqliteTable("contractor_user", {
  id: text("id").primaryKey(),
  ...ownedFields,
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
}, (t) => [
  uniqueIndex("contractor_user_contractor_uq").on(t.businessId, t.contractorId),
  uniqueIndex("contractor_user_business_user_uq").on(t.businessId, t.userId),
  index("contractor_user_user_idx").on(t.userId),
]);

export const assignments = sqliteTable("assignment", {
  id: text("id").primaryKey(),
  ...ownedFields,
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "cascade" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  rateCents: integer("rate_cents"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
}, (t) => [
  index("assignment_owner_idx").on(t.ownerUserId),
  index("assignment_contractor_idx").on(t.contractorId),
  index("assignment_site_idx").on(t.siteId),
  uniqueIndex("assignment_owner_contractor_site_uq").on(t.ownerUserId, t.contractorId, t.siteId),
]);

export const assignmentScheduleVersions = sqliteTable("assignment_schedule_version", {
  id: text("id").primaryKey(),
  ...ownedFields,
  assignmentId: text("assignment_id").notNull().references(() => assignments.id, { onDelete: "restrict" }),
  weekdaysMask: integer("weekdays_mask").notNull(),
  paidMinutes: integer("paid_minutes").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to"),
}, (t) => [
  index("assignment_schedule_version_owner_idx").on(t.ownerUserId),
  index("assignment_schedule_version_assignment_idx").on(t.ownerUserId, t.assignmentId, t.effectiveFrom),
]);

export const timeEntries = sqliteTable("time_entry", {
  id: text("id").primaryKey(),
  ...ownedFields,
  contractorId: text("contractor_id").notNull().references(() => contractors.id, { onDelete: "restrict" }),
  siteId: text("site_id").notNull().references(() => sites.id, { onDelete: "restrict" }),
  workDate: text("work_date").notNull(),
  startMinutes: integer("start_minutes").notNull(),
  endMinutes: integer("end_minutes").notNull(),
  breakMinutes: integer("break_minutes").notNull().default(0),
  paidMinutes: integer("paid_minutes").notNull(),
  rateCents: integer("rate_cents").notNull(),
  notes: text("notes").notNull().default(""),
  entryMode: text("entry_mode").notNull().default("clock").$type<"clock" | "paid_hours" | "absent">(),
  occurrenceKind: text("occurrence_kind").notNull().default("manual").$type<"manual" | "scheduled" | "absent" | "hours_override">(),
  scheduleVersionId: text("schedule_version_id"),
}, (t) => [
  index("time_entry_owner_week_idx").on(t.ownerUserId, t.workDate),
  index("time_entry_contractor_idx").on(t.contractorId),
  index("time_entry_site_idx").on(t.siteId),
  uniqueIndex("time_entry_owner_contractor_site_date_uq").on(t.ownerUserId, t.contractorId, t.siteId, t.workDate),
]);

export const opsAudit = sqliteTable("ops_audit", {
  id: text("id").primaryKey(),
  action: text("action").notNull(),
  sqlText: text("sql_text"),
  paramsJson: text("params_json"),
  oldJson: text("old_json"),
  newJson: text("new_json"),
  reason: text("reason").notNull(),
  rowCount: integer("row_count").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (t) => [index("ops_audit_created_at_idx").on(t.createdAt)]);

export const weekApprovals = sqliteTable("week_approval", {
  id: text("id").primaryKey(),
  ...ownedFields,
  weekStart: text("week_start").notNull(),
  status: text("status").notNull().$type<"approved" | "reopened">(),
  approvedAt: integer("approved_at", { mode: "timestamp" }).notNull(),
  reopenedAt: integer("reopened_at", { mode: "timestamp" }),
}, (t) => [uniqueIndex("week_approval_owner_week_uq").on(t.ownerUserId, t.weekStart)]);

export const authSchema = { user, session, account, verification, rateLimit };
