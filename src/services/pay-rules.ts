import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { businessHolidays, businessPayRules } from "@/db/schema";
import { activeOwnerMembership } from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import { nzPublicHolidayDates, type ShiftPayRules } from "@/lib/payroll";
import type { z } from "zod";
import type { businessHolidayInput, payRulesInput } from "@/lib/validation";

type Database = typeof db;
type PayRulesInput = z.infer<typeof payRulesInput>;
type BusinessHolidayInput = z.infer<typeof businessHolidayInput>;

export const DEFAULT_PAY_RULES: PayRulesInput = {
  holidayMode: "off",
  holidayMultiplierBps: null,
  useNzPublicHolidays: false,
  weekendSaturdayMultiplierBps: null,
  weekendSundayMultiplierBps: null,
  overnightStartMinutes: null,
  overnightEndMinutes: null,
  overnightMultiplierBps: null,
};

async function ownerScope(database: Database, userId: string) {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) throw new Error("forbidden");
  return { ownerUserId: userId, businessId: membership.businessId };
}

function toPayRules(row: typeof businessPayRules.$inferSelect | undefined): PayRulesInput {
  if (!row) return { ...DEFAULT_PAY_RULES };
  return {
    holidayMode: row.holidayMode,
    holidayMultiplierBps: row.holidayMultiplierBps,
    useNzPublicHolidays: row.useNzPublicHolidays,
    weekendSaturdayMultiplierBps: row.weekendSaturdayMultiplierBps,
    weekendSundayMultiplierBps: row.weekendSundayMultiplierBps,
    overnightStartMinutes: row.overnightStartMinutes,
    overnightEndMinutes: row.overnightEndMinutes,
    overnightMultiplierBps: row.overnightMultiplierBps,
  };
}

export async function getPayRules(database: Database, userId: string): Promise<PayRulesInput> {
  const scope = await ownerScope(database, userId);
  const [row] = await database.select().from(businessPayRules).where(and(
    eq(businessPayRules.businessId, scope.businessId),
    eq(businessPayRules.ownerUserId, scope.ownerUserId),
  )).limit(1);
  return toPayRules(row);
}

export async function putPayRules(database: Database, userId: string, input: PayRulesInput): Promise<PayRulesInput> {
  const scope = await ownerScope(database, userId);
  const timestamp = new Date();
  await database.insert(businessPayRules).values({
    ...scope,
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoUpdate({
    target: businessPayRules.businessId,
    set: { ...input, ownerUserId: scope.ownerUserId, updatedAt: timestamp },
  });
  return input;
}

export async function listBusinessHolidays(database: Database, userId: string) {
  const scope = await ownerScope(database, userId);
  return database.select({
    id: businessHolidays.id,
    holidayDate: businessHolidays.holidayDate,
    name: businessHolidays.name,
    createdAt: businessHolidays.createdAt,
    updatedAt: businessHolidays.updatedAt,
  }).from(businessHolidays).where(and(
    eq(businessHolidays.businessId, scope.businessId),
    eq(businessHolidays.ownerUserId, scope.ownerUserId),
  )).orderBy(asc(businessHolidays.holidayDate), asc(businessHolidays.name));
}

export async function createBusinessHoliday(database: Database, userId: string, input: BusinessHolidayInput) {
  const scope = await ownerScope(database, userId);
  const timestamp = new Date();
  const row = { id: crypto.randomUUID(), ...scope, ...input, createdAt: timestamp, updatedAt: timestamp };
  try {
    await database.insert(businessHolidays).values(row);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("invalid_request");
    throw error;
  }
  return { id: row.id, holidayDate: row.holidayDate, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function deleteBusinessHoliday(database: Database, userId: string, holidayId: string): Promise<boolean> {
  const scope = await ownerScope(database, userId);
  const rows = await database.delete(businessHolidays).where(and(
    eq(businessHolidays.id, holidayId),
    eq(businessHolidays.businessId, scope.businessId),
    eq(businessHolidays.ownerUserId, scope.ownerUserId),
  )).returning({ id: businessHolidays.id });
  return rows.length === 1;
}

export async function payRuleSnapshot(database: Database, ownerUserId: string, businessId: string, workDate: string): Promise<{
  rules: ShiftPayRules;
  holidayDates: Set<string>;
}> {
  const [row, holidays] = await Promise.all([
    database.select().from(businessPayRules).where(and(
      eq(businessPayRules.businessId, businessId),
      eq(businessPayRules.ownerUserId, ownerUserId),
    )).limit(1),
    database.select({ holidayDate: businessHolidays.holidayDate }).from(businessHolidays).where(and(
      eq(businessHolidays.businessId, businessId),
      eq(businessHolidays.ownerUserId, ownerUserId),
    )),
  ]);
  const rules = toPayRules(row[0]);
  const holidayDates = new Set(holidays.map((holiday) => holiday.holidayDate));
  const year = Number(workDate.slice(0, 4));
  if (rules.useNzPublicHolidays && year >= 2024 && year <= 2030) {
    for (const holiday of nzPublicHolidayDates(year)) holidayDates.add(holiday.date);
  }
  return { rules, holidayDates };
}
