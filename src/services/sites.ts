import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assignments, sites } from "@/db/schema";
import { ownerBusinessIdOrNull, requireOwnerBusinessId } from "@/lib/business";
import { isUniqueConstraintError } from "@/lib/db-errors";
import type { z } from "zod";
import type { siteInput } from "@/lib/validation";

type Database = typeof db;
type SiteInput = z.infer<typeof siteInput>;

const now = () => new Date();
const id = () => crypto.randomUUID();

const siteFields = { id: sites.id, name: sites.name, address: sites.address, active: sites.active, updatedAt: sites.updatedAt };

async function loadOwnedSite(database: Database, ownerUserId: string, businessId: string, siteId: string) {
  const [site] = await database.select(siteFields).from(sites).where(and(
    eq(sites.id, siteId),
    eq(sites.ownerUserId, ownerUserId),
    eq(sites.businessId, businessId),
  )).limit(1);
  return site;
}

export async function createSite(database: Database, ownerUserId: string, input: SiteInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const row = { id: id(), ownerUserId, businessId, ...input, active: true, createdAt: now(), updatedAt: now() };
  try {
    await database.insert(sites).values(row);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_site");
    throw error;
  }
  return { id: row.id, ownerUserId, name: input.name, address: input.address, active: true, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function listSites(database: Database, ownerUserId: string, includeArchived = false) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) return [];
  const scoped = includeArchived
    ? and(eq(sites.ownerUserId, ownerUserId), eq(sites.businessId, businessId))
    : and(eq(sites.ownerUserId, ownerUserId), eq(sites.businessId, businessId), eq(sites.active, true));
  return database.select(siteFields).from(sites).where(scoped).orderBy(asc(sites.name));
}

export async function getSite(database: Database, ownerUserId: string, siteId: string) {
  const businessId = await ownerBusinessIdOrNull(database, ownerUserId);
  if (!businessId) throw new Error("not_found");
  const site = await loadOwnedSite(database, ownerUserId, businessId, siteId);
  if (!site) throw new Error("not_found");
  return site;
}

export async function updateSite(database: Database, ownerUserId: string, siteId: string, input: SiteInput) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const site = await loadOwnedSite(database, ownerUserId, businessId, siteId);
  if (!site) throw new Error("not_found");
  const updatedAt = now();
  try {
    await database.update(sites).set({ name: input.name, address: input.address, updatedAt }).where(and(
      eq(sites.id, siteId),
      eq(sites.ownerUserId, ownerUserId),
      eq(sites.businessId, businessId),
    ));
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_site");
    throw error;
  }
  return { ...site, name: input.name, address: input.address, updatedAt };
}

export async function archiveSite(database: Database, ownerUserId: string, siteId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const site = await loadOwnedSite(database, ownerUserId, businessId, siteId);
  if (!site || site.active === false) throw new Error("not_found");
  const updatedAt = now();
  await database.batch([
    database.update(sites).set({ active: false, updatedAt }).where(and(
      eq(sites.id, siteId),
      eq(sites.ownerUserId, ownerUserId),
      eq(sites.businessId, businessId),
      eq(sites.active, true),
    )),
    database.update(assignments).set({ active: false, updatedAt }).where(and(
      eq(assignments.siteId, siteId),
      eq(assignments.ownerUserId, ownerUserId),
      eq(assignments.businessId, businessId),
      eq(assignments.active, true),
    )),
  ]);
  return { ...site, active: false as const, updatedAt };
}

export async function restoreSite(database: Database, ownerUserId: string, siteId: string) {
  const businessId = await requireOwnerBusinessId(database, ownerUserId);
  const site = await loadOwnedSite(database, ownerUserId, businessId, siteId);
  if (!site || site.active === true) throw new Error("not_found");
  const updatedAt = now();
  try {
    await database.batch([
      database.update(sites).set({ active: true, updatedAt }).where(and(
        eq(sites.id, siteId),
        eq(sites.ownerUserId, ownerUserId),
        eq(sites.businessId, businessId),
        eq(sites.active, false),
      )),
      database.update(assignments).set({ active: true, updatedAt }).where(and(
        eq(assignments.siteId, siteId),
        eq(assignments.ownerUserId, ownerUserId),
        eq(assignments.businessId, businessId),
        eq(assignments.active, false),
      )),
    ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new Error("duplicate_site");
    throw error;
  }
  return { ...site, active: true as const, updatedAt };
}
