import { and, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { businessMember } from "@/db/schema";

type Database = typeof db;

export type OwnerMembership = {
  id: string;
  businessId: string;
  userId: string;
  role: string;
  active: number;
};

export type BusinessResource = {
  id: string;
  name: string;
  nzbn: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  currency: string;
  weekStart: string;
  onboardingCompletedAt: string | null;
};

export function businessIdForUser(userId: string): string {
  return `biz_${userId}`;
}

export function membershipIdForUser(userId: string): string {
  return `mem_${userId}`;
}

export function toBusinessResource(row: {
  id: string;
  name: string;
  nzbn: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  currency: string;
  weekStart: string;
  onboardingCompletedAt: Date | null;
}): BusinessResource {
  return {
    id: row.id,
    name: row.name,
    nzbn: row.nzbn,
    address: row.address,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    timezone: row.timezone,
    currency: row.currency,
    weekStart: row.weekStart,
    onboardingCompletedAt: row.onboardingCompletedAt ? row.onboardingCompletedAt.toISOString() : null,
  };
}

export async function activeOwnerMembership(database: Database, userId: string): Promise<OwnerMembership | null> {
  const rows = await database
    .select({
      id: businessMember.id,
      businessId: businessMember.businessId,
      userId: businessMember.userId,
      role: businessMember.role,
      active: businessMember.active,
    })
    .from(businessMember)
    .where(and(
      eq(businessMember.userId, userId),
      eq(businessMember.active, 1),
      eq(businessMember.role, "owner"),
    ));
  if (rows.length > 1) throw new Error("multiple_active_memberships");
  return rows[0] ?? null;
}

export async function requireOwnerBusinessId(database: Database, userId: string): Promise<string> {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) throw new Error("business_required");
  return membership.businessId;
}

export async function ownerBusinessIdOrNull(database: Database, userId: string): Promise<string | null> {
  const membership = await activeOwnerMembership(database, userId);
  return membership?.businessId ?? null;
}
