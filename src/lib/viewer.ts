import { and, asc, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { business, contractorAccount } from "@/db/schema";
import { activeOwnerMembership, toBusinessResource, type BusinessResource } from "@/lib/business";
import type { ContractorLink } from "@/lib/viewer-path";

type Database = typeof db;

export type Viewer = {
  owner: BusinessResource | null;
  contractorOf: ContractorLink[];
};

export async function resolveViewer(database: Database, userId: string): Promise<Viewer> {
  const owner = await ownerProfile(database, userId);
  const contractorOf = await activeContractorLinks(database, userId);
  return { owner, contractorOf };
}

async function ownerProfile(database: Database, userId: string): Promise<BusinessResource | null> {
  const membership = await activeOwnerMembership(database, userId);
  if (!membership) return null;
  const [row] = await database.select().from(business).where(eq(business.id, membership.businessId)).limit(1);
  if (!row) return null;
  return toBusinessResource(row);
}

async function activeContractorLinks(database: Database, userId: string): Promise<ContractorLink[]> {
  const rows = await database
    .select({ businessId: business.id, businessName: business.name })
    .from(contractorAccount)
    .innerJoin(business, eq(business.id, contractorAccount.businessId))
    .where(and(eq(contractorAccount.userId, userId), eq(contractorAccount.active, 1)))
    .orderBy(asc(business.name));
  return rows;
}
