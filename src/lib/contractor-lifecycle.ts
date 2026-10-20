import { isUniqueConstraintError } from "@/lib/db-errors";

export const ENGAGEMENT_STATUSES = ["draft", "invited", "active", "suspended", "archived"] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export type IncludeArchivedQuery = { ok: true; includeArchived: boolean } | { ok: false };

const SCHEDULABLE_STATUSES = new Set<EngagementStatus>(["invited", "active"]);
const PORTAL_ACCESS_STATUSES = new Set<EngagementStatus>(["invited", "active"]);

export function isEngagementStatus(value: string): value is EngagementStatus {
  return (ENGAGEMENT_STATUSES as readonly string[]).includes(value);
}

export function activeForEngagementStatus(status: EngagementStatus): boolean {
  return SCHEDULABLE_STATUSES.has(status);
}

export function contractorMayHoldPortalAccess(status: EngagementStatus): boolean {
  return PORTAL_ACCESS_STATUSES.has(status);
}

export type EngagementAssignmentEffect = "deactivate" | "reactivate" | "none";

export function engagementAssignmentEffect(previous: EngagementStatus, next: EngagementStatus): EngagementAssignmentEffect {
  if (previous === next) return "none";
  if (next === "archived") return "deactivate";
  if (previous === "archived" && activeForEngagementStatus(next)) return "reactivate";
  return "none";
}

export function parseIncludeArchived(value: string | null): IncludeArchivedQuery {
  if (value === null || value === "" || value === "false" || value === "0") {
    return { ok: true, includeArchived: false };
  }
  if (value === "true" || value === "1") return { ok: true, includeArchived: true };
  return { ok: false };
}

export function contractorVisibleInList(contractor: { engagementStatus: EngagementStatus }, includeArchived: boolean): boolean {
  return includeArchived || contractor.engagementStatus !== "archived";
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
  set: { active: boolean; engagementStatus?: EngagementStatus };
  where: { ownerUserId: string; contractorId: string } | { ownerUserId: string; id: string };
};

export function archiveWritePlan(ownerUserId: string, contractorId: string): LifecycleWrite[] {
  return [
    { table: "assignment", action: "update", set: { active: false }, where: { ownerUserId, contractorId } },
    { table: "contractor", action: "update", set: { active: false, engagementStatus: "archived" }, where: { ownerUserId, id: contractorId } },
  ];
}

export function restoreWritePlan(ownerUserId: string, contractorId: string): LifecycleWrite[] {
  return [
    { table: "contractor", action: "update", set: { active: true, engagementStatus: "active" }, where: { ownerUserId, id: contractorId } },
    { table: "assignment", action: "update", set: { active: true }, where: { ownerUserId, contractorId } },
  ];
}

export function requireOwnedContractor<T>(row: T | undefined | null): T {
  if (!row) throw new Error("not_found");
  return row;
}

export type ContractorEngagementPatch = {
  preferredName?: string;
  startDate?: string | null;
  engagementStatus?: EngagementStatus;
  gstRegistered?: boolean;
  gstNumber?: string;
  internalNotes?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

export type ContractorProfileInput = {
  name: string;
  email: string;
  phone: string;
  defaultRateCents: number;
};

export type ContractorEngagementColumns = {
  preferredName: string;
  startDate: string | null;
  engagementStatus: EngagementStatus;
  gstRegistered: boolean;
  gstNumber: string;
  internalNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  active: boolean;
};

export function engagementColumnsForCreate(input: ContractorEngagementPatch): ContractorEngagementColumns {
  const engagementStatus = input.engagementStatus ?? "active";
  return {
    preferredName: input.preferredName ?? "",
    startDate: input.startDate ?? null,
    engagementStatus,
    gstRegistered: input.gstRegistered ?? false,
    gstNumber: input.gstNumber ?? "",
    internalNotes: input.internalNotes ?? "",
    emergencyContactName: input.emergencyContactName ?? "",
    emergencyContactPhone: input.emergencyContactPhone ?? "",
    active: activeForEngagementStatus(engagementStatus),
  };
}

export function contractorUpdateWriteSet(input: ContractorProfileInput & ContractorEngagementPatch, updatedAt: Date) {
  const set: ContractorProfileInput & Partial<ContractorEngagementColumns> & { updatedAt: Date } = {
    name: input.name,
    email: input.email,
    phone: input.phone,
    defaultRateCents: input.defaultRateCents,
    updatedAt,
  };
  if (input.preferredName !== undefined) set.preferredName = input.preferredName;
  if (input.startDate !== undefined) set.startDate = input.startDate;
  if (input.engagementStatus !== undefined) {
    set.engagementStatus = input.engagementStatus;
    set.active = activeForEngagementStatus(input.engagementStatus);
  }
  if (input.gstRegistered !== undefined) set.gstRegistered = input.gstRegistered;
  if (input.gstNumber !== undefined) set.gstNumber = input.gstNumber;
  if (input.internalNotes !== undefined) set.internalNotes = input.internalNotes;
  if (input.emergencyContactName !== undefined) set.emergencyContactName = input.emergencyContactName;
  if (input.emergencyContactPhone !== undefined) set.emergencyContactPhone = input.emergencyContactPhone;
  return set;
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
  preferredName: string;
  startDate: string | null;
  engagementStatus: EngagementStatus;
  gstRegistered: boolean;
  gstNumber: string;
  internalNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
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
  preferredName: string;
  startDate: string | null;
  engagementStatus: EngagementStatus;
  gstRegistered: boolean;
  gstNumber: string;
  internalNotes: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
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
    preferredName: row.preferredName,
    startDate: row.startDate,
    engagementStatus: row.engagementStatus,
    gstRegistered: row.gstRegistered,
    gstNumber: row.gstNumber,
    internalNotes: row.internalNotes,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
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
