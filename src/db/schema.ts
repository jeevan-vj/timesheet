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

const ownedFields = {
  ownerUserId: text("owner_user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
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
}, (t) => [index("contractor_owner_idx").on(t.ownerUserId), uniqueIndex("contractor_owner_name_uq").on(t.ownerUserId, t.name)]);

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
  entryMode: text("entry_mode").notNull().default("clock").$type<"clock" | "paid_hours">(),
}, (t) => [
  index("time_entry_owner_week_idx").on(t.ownerUserId, t.workDate),
  index("time_entry_contractor_idx").on(t.contractorId),
  index("time_entry_site_idx").on(t.siteId),
  uniqueIndex("time_entry_owner_contractor_site_date_uq").on(t.ownerUserId, t.contractorId, t.siteId, t.workDate),
]);

export const weekApprovals = sqliteTable("week_approval", {
  id: text("id").primaryKey(),
  ...ownedFields,
  weekStart: text("week_start").notNull(),
  status: text("status").notNull().$type<"approved" | "reopened">(),
  approvedAt: integer("approved_at", { mode: "timestamp" }).notNull(),
  reopenedAt: integer("reopened_at", { mode: "timestamp" }),
}, (t) => [uniqueIndex("week_approval_owner_week_uq").on(t.ownerUserId, t.weekStart)]);

export const authSchema = { user, session, account, verification, rateLimit };
