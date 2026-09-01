import { isUniqueConstraintError } from "@/lib/db-errors";

export type IncludeArchivedQuery = { ok: true; includeArchived: boolean } | { ok: false };

export function parseIncludeArchived(value: string | null): IncludeArchivedQuery {
  if (value === null || value === "" || value === "false" || value === "0") {
    return { ok: true, includeArchived: false };
  }
  if (value === "true" || value === "1") return { ok: true, includeArchived: true };
  return { ok: false };
}

export function contractorVisibleInList(contractor: { active: boolean }, includeArchived: boolean): boolean {
  return includeArchived || contractor.active;
}

export function contractorNameConflicts(input: {
  ownerUserId: string;
  name: string;
  existing: Array<{ id: string; ownerUserId: string; name: string }>;
  excludeId?: string;
}): boolean {
  const name = input.name.trim();
  return input.existing.some((row) => (
    row.ownerUserId === input.ownerUserId
    && row.name === name
    && row.id !== input.excludeId
  ));
}

export type LifecycleWrite = {
  table: "assignment" | "contractor";
  action: "update";
  set: { active: boolean };
  where: { ownerUserId: string; contractorId: string } | { ownerUserId: string; id: string };
};

export function archiveWritePlan(ownerUserId: string, contractorId: string): LifecycleWrite[] {
  return [
    { table: "assignment", action: "update", set: { active: false }, where: { ownerUserId, contractorId } },
    { table: "contractor", action: "update", set: { active: false }, where: { ownerUserId, id: contractorId } },
  ];
}

export function restoreWritePlan(ownerUserId: string, contractorId: string): LifecycleWrite[] {
  return [
    { table: "contractor", action: "update", set: { active: true }, where: { ownerUserId, id: contractorId } },
    { table: "assignment", action: "update", set: { active: true }, where: { ownerUserId, contractorId } },
  ];
}

export function requireOwnedContractor<T>(row: T | undefined | null): T {
  if (!row) throw new Error("not_found");
  return row;
}

export function contractorUpdateWriteSet(
  input: { name: string; email: string; phone: string; defaultRateCents: number },
  updatedAt: Date,
) {
  return {
    name: input.name,
    email: input.email,
    phone: input.phone,
    defaultRateCents: input.defaultRateCents,
    updatedAt,
  };
}

export type ContractorRow = {
  id: string;
  ownerUserId: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  currency: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type ContractorResource = {
  id: string;
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
  currency: "NZD";
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export function toContractorResource(row: ContractorRow): ContractorResource {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    defaultRateCents: row.defaultRateCents,
    currency: "NZD",
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapContractorWriteError(error: unknown): never {
  if (isUniqueConstraintError(error)) throw new Error("duplicate_contractor");
  throw error;
}

export function dashboardAssignmentsForSelect<
  A extends { contractorId: string; active: boolean },
  C extends { id: string; active: boolean },
>(assignments: A[], contractors: C[]): A[] {
  const activeContractorIds = new Set(contractors.filter((contractor) => contractor.active).map((contractor) => contractor.id));
  return assignments.filter((assignment) => assignment.active && activeContractorIds.has(assignment.contractorId));
}

export function isValidContractorId(id: string): boolean {
  return Boolean(id) && id.length <= 64;
}
