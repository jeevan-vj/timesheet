import { and, eq, isNull } from "drizzle-orm";
import type { db } from "@/db/client";
import { business, businessMember, contractorUsers } from "@/db/schema";
import {
  activeOwnerMembership,
  businessIdForUser,
  membershipIdForUser,
  toBusinessResource,
  type BusinessResource,
} from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import type { businessInput } from "@/lib/validation";
import type { z } from "zod";

type Database = typeof db;
type BusinessInput = z.infer<typeof businessInput>;

async function loadBusiness(database: Database, businessId: string) {
  const [row] = await database.select().from(business).where(eq(business.id, businessId)).limit(1);
  return row ?? null;
}

async function insertOwnerMembership(database: Database, userId: string, businessId: string, timestamp: Date): Promise<"inserted" | "exists"> {
  try {
    await database.insert(businessMember).values({
      id: membershipIdForUser(userId),
      businessId,
      userId,
      role: "owner",
      active: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    return "inserted";
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    return "exists";
  }
}

export async function businessResourceForUser(database: Database, userId: string): Promise<BusinessResource | null> {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) return null;
  const row = await loadBusiness(database, membership.businessId);
  return row ? toBusinessResource(row) : null;
}

async function resourceForMembership(database: Database, userId: string): Promise<BusinessResource | null> {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) return null;
  const row = await loadBusiness(database, membership.businessId);
  if (!row) throw new Error("not_found");
  return toBusinessResource(row);
}

async function resourceAfterBusinessConflict(
  database: Database,
  userId: string,
  businessId: string,
  timestamp: Date,
  cause: unknown,
): Promise<BusinessResource> {
  const stored = await loadBusiness(database, businessId);
  if (!stored) throw cause;
  await insertOwnerMembership(database, userId, stored.id, timestamp);
  return (await resourceForMembership(database, userId)) ?? toBusinessResource(stored);
}

export async function createOwnerBusiness(
  database: Database,
  userId: string,
  input: BusinessInput,
): Promise<{ resource: BusinessResource; created: boolean }> {
  const existing = await resourceForMembership(database, userId);
  if (existing) return { resource: existing, created: false };
  const [contractorLink] = await database.select({ id: contractorUsers.id }).from(contractorUsers).where(eq(contractorUsers.userId, userId)).limit(1);
  if (contractorLink) throw new Error("forbidden");

  const timestamp = new Date();
  const businessId = businessIdForUser(userId);
  const row = {
    id: businessId,
    name: input.name,
    nzbn: input.nzbn,
    address: input.address,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    timezone: input.timezone,
    currency: input.currency,
    weekStart: input.weekStart,
    onboardingCompletedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  try {
    await database.insert(business).values(row);
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const resource = await resourceAfterBusinessConflict(database, userId, businessId, timestamp, error);
    return { resource, created: false };
  }

  const membershipResult = await insertOwnerMembership(database, userId, businessId, timestamp);
  if (membershipResult === "exists") {
    const resource = await resourceForMembership(database, userId);
    if (!resource) throw new Error("not_found");
    return { resource, created: false };
  }
  return { resource: toBusinessResource(row), created: true };
}

export async function completeOnboarding(database: Database, userId: string): Promise<BusinessResource> {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) throw new Error("business_required");
  const row = await loadBusiness(database, membership.businessId);
  if (!row) throw new Error("business_required");
  if (row.onboardingCompletedAt) return toBusinessResource(row);

  const completedAt = new Date();
  await database
    .update(business)
    .set({ onboardingCompletedAt: completedAt, updatedAt: completedAt })
    .where(and(eq(business.id, row.id), isNull(business.onboardingCompletedAt)));
  const stored = await loadBusiness(database, row.id);
  if (!stored) throw new Error("business_required");
  return toBusinessResource(stored);
}
