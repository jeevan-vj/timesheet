import { and, eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { weekApprovals } from "@/db/schema";

type Database = typeof db;

export async function findWeekApproval(database: Database, ownerUserId: string, weekStart: string) {
  const [row] = await database
    .select()
    .from(weekApprovals)
    .where(and(eq(weekApprovals.ownerUserId, ownerUserId), eq(weekApprovals.weekStart, weekStart)))
    .limit(1);
  return row ?? null;
}
