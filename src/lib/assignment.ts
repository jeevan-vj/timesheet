import { isUniqueConstraintError } from "@/lib/db-errors";

export type RelationStatus = "active" | "inactive" | "missing";

export type AssignmentClock = {
  id: () => string;
  now: () => Date;
};

export type ContractorRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  defaultRateCents: number;
  active: boolean;
};

export type SiteRecord = {
  id: string;
  ownerUserId: string;
  name: string;
  active: boolean;
};

export type AssignmentRecord = {
  id: string;
  ownerUserId: string;
  contractorId: string;
  siteId: string;
  rateCents: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AssignmentPatch = {
  updatedAt: Date;
  active?: boolean;
  rateCents?: number | null;
};

export type JoinedAssignment = {
  id: string;
  contractorId: string;
  contractorName: string;
  contractorDefaultRateCents: number;
  contractorActive: boolean;
  siteId: string;
  siteName: string;
  siteActive: boolean;
  rateCents: number | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AssignmentView = {
  id: string;
  contractorId: string;
  contractorName: string;
  siteId: string;
  siteName: string;
  rateCents: number | null;
  effectiveRateCents: number;
  rateInherited: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type AssignmentRepository = {
  getContractor(ownerUserId: string, contractorId: string): Promise<ContractorRecord | undefined>;
  getSite(ownerUserId: string, siteId: string): Promise<SiteRecord | undefined>;
  getAssignmentByPair(ownerUserId: string, contractorId: string, siteId: string): Promise<AssignmentRecord | undefined>;
  getAssignmentById(ownerUserId: string, assignmentId: string): Promise<AssignmentRecord | undefined>;
  insertAssignment(row: AssignmentRecord): Promise<void>;
  updateAssignment(ownerUserId: string, assignmentId: string, patch: AssignmentPatch): Promise<void>;
  listJoinedAssignments(ownerUserId: string): Promise<JoinedAssignment[]>;
  getJoinedAssignment(ownerUserId: string, assignmentId: string): Promise<JoinedAssignment | undefined>;
};

export type AssignmentWritePlan =
  | { type: "insert" }
  | { type: "restore"; id: string; applyRate: true }
  | { type: "duplicate" }
  | { type: "not_found" };

export type RestorePlan =
  | { type: "restore" }
  | { type: "noop" }
  | { type: "not_found" };

export type InlineAssignmentIntent =
  | { type: "use_existing" }
  | { type: "insert"; rateCents: number | null }
  | { type: "restore"; id: string; rateCents: number | null }
  | { type: "not_found" };

export function ownedRelationStatus(row: { active: boolean } | undefined): RelationStatus {
  if (!row) return "missing";
  return row.active ? "active" : "inactive";
}

export function planAssignmentWrite(input: {
  contractor: RelationStatus;
  site: RelationStatus;
  existing: { id: string; active: boolean } | null;
}): AssignmentWritePlan {
  if (input.contractor !== "active" || input.site !== "active") return { type: "not_found" };
  if (input.existing?.active) return { type: "duplicate" };
  if (!input.existing) return { type: "insert" };
  return { type: "restore", id: input.existing.id, applyRate: true };
}

export function planRestoreAssignment(input: {
  assignment: { active: boolean } | null;
  contractor: RelationStatus;
  site: RelationStatus;
}): RestorePlan {
  if (!input.assignment) return { type: "not_found" };
  if (input.assignment.active) return { type: "noop" };
  if (input.contractor !== "active" || input.site !== "active") return { type: "not_found" };
  return { type: "restore" };
}

export function inlineAssignmentIntent(input: {
  assignSite: { rateCents: number | null } | undefined;
  existing: { id: string; active: boolean; rateCents: number | null } | null;
  contractor: RelationStatus;
  site: RelationStatus;
}): InlineAssignmentIntent {
  if (!input.assignSite) {
    if (input.existing?.active) return { type: "use_existing" };
    return { type: "not_found" };
  }
  if (input.existing?.active) return { type: "use_existing" };
  if (input.contractor !== "active" || input.site !== "active") return { type: "not_found" };
  if (!input.existing) return { type: "insert", rateCents: input.assignSite.rateCents };
  return { type: "restore", id: input.existing.id, rateCents: input.assignSite.rateCents };
}

export function toAssignmentView(row: JoinedAssignment): AssignmentView {
  return {
    id: row.id,
    contractorId: row.contractorId,
    contractorName: row.contractorName,
    siteId: row.siteId,
    siteName: row.siteName,
    rateCents: row.rateCents,
    effectiveRateCents: row.rateCents ?? row.contractorDefaultRateCents,
    rateInherited: row.rateCents === null,
    active: row.active,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function isNewEntryAssignment(input: {
  assignmentActive: boolean;
  contractorOwned: boolean;
  contractorActive: boolean;
  siteOwned: boolean;
  siteActive: boolean;
}): boolean {
  return input.assignmentActive && input.contractorOwned && input.contractorActive && input.siteOwned && input.siteActive;
}

export function assignmentHttpStatus(code: string): { status: number; error: string } {
  if (code === "not_found") return { status: 404, error: "not_found" };
  if (code === "duplicate_assignment") return { status: 409, error: "duplicate_assignment" };
  return { status: 400, error: "invalid_request" };
}

export async function runGetAssignment(repo: AssignmentRepository, ownerUserId: string, assignmentId: string): Promise<AssignmentView> {
  const row = await repo.getJoinedAssignment(ownerUserId, assignmentId);
  if (!row) throw new Error("not_found");
  return toAssignmentView(row);
}

export async function runListAssignments(repo: AssignmentRepository, ownerUserId: string): Promise<AssignmentView[]> {
  return (await repo.listJoinedAssignments(ownerUserId)).map(toAssignmentView);
}

export async function runCreateAssignment(
  repo: AssignmentRepository,
  ownerUserId: string,
  input: { contractorId: string; siteId: string; rateCents: number | null },
  clock: AssignmentClock,
): Promise<{ created: boolean; assignment: AssignmentView }> {
  const contractor = await repo.getContractor(ownerUserId, input.contractorId);
  const site = await repo.getSite(ownerUserId, input.siteId);
  const existing = await repo.getAssignmentByPair(ownerUserId, input.contractorId, input.siteId);
  const plan = planAssignmentWrite({
    contractor: ownedRelationStatus(contractor),
    site: ownedRelationStatus(site),
    existing: existing ? { id: existing.id, active: existing.active } : null,
  });
  if (plan.type === "not_found") throw new Error("not_found");
  if (plan.type === "duplicate") throw new Error("duplicate_assignment");

  const timestamp = clock.now();
  let assignmentId: string;
  if (plan.type === "restore") {
    assignmentId = plan.id;
    await repo.updateAssignment(ownerUserId, assignmentId, {
      active: true,
      rateCents: input.rateCents,
      updatedAt: timestamp,
    });
  } else {
    assignmentId = clock.id();
    try {
      await repo.insertAssignment({
        id: assignmentId,
        ownerUserId,
        contractorId: input.contractorId,
        siteId: input.siteId,
        rateCents: input.rateCents,
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new Error("duplicate_assignment");
      throw error;
    }
  }

  return { created: plan.type === "insert", assignment: await runGetAssignment(repo, ownerUserId, assignmentId) };
}

export async function runUpdateAssignmentRate(
  repo: AssignmentRepository,
  ownerUserId: string,
  assignmentId: string,
  rateCents: number | null,
  clock: AssignmentClock,
): Promise<AssignmentView> {
  const existing = await repo.getAssignmentById(ownerUserId, assignmentId);
  if (!existing) throw new Error("not_found");
  await repo.updateAssignment(ownerUserId, assignmentId, { rateCents, updatedAt: clock.now() });
  return runGetAssignment(repo, ownerUserId, assignmentId);
}

export async function runUnassignAssignment(
  repo: AssignmentRepository,
  ownerUserId: string,
  assignmentId: string,
  clock: AssignmentClock,
): Promise<boolean> {
  const existing = await repo.getAssignmentById(ownerUserId, assignmentId);
  if (!existing) return false;
  if (!existing.active) return true;
  await repo.updateAssignment(ownerUserId, assignmentId, { active: false, updatedAt: clock.now() });
  return true;
}

export async function runRestoreAssignment(
  repo: AssignmentRepository,
  ownerUserId: string,
  assignmentId: string,
  clock: AssignmentClock,
): Promise<AssignmentView> {
  const existing = await repo.getAssignmentById(ownerUserId, assignmentId);
  const contractor = existing ? await repo.getContractor(ownerUserId, existing.contractorId) : undefined;
  const site = existing ? await repo.getSite(ownerUserId, existing.siteId) : undefined;
  const plan = planRestoreAssignment({
    assignment: existing ? { active: existing.active } : null,
    contractor: ownedRelationStatus(contractor),
    site: ownedRelationStatus(site),
  });
  if (plan.type === "not_found") throw new Error("not_found");
  if (plan.type === "restore") {
    await repo.updateAssignment(ownerUserId, existing!.id, { active: true, updatedAt: clock.now() });
  }
  return runGetAssignment(repo, ownerUserId, existing!.id);
}

export async function applyInlineAssignSite(
  repo: AssignmentRepository,
  ownerUserId: string,
  input: { contractorId: string; siteId: string; assignSite?: { rateCents: number | null } },
  clock: AssignmentClock,
): Promise<void> {
  if (!input.assignSite) return;
  try {
    await runCreateAssignment(repo, ownerUserId, {
      contractorId: input.contractorId,
      siteId: input.siteId,
      rateCents: input.assignSite.rateCents,
    }, clock);
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate_assignment") return;
    throw error;
  }
}

export async function applyInlineAssignSiteAfterPrecheck(
  repo: AssignmentRepository,
  ownerUserId: string,
  input: { contractorId: string; siteId: string; assignSite?: { rateCents: number | null } },
  clock: AssignmentClock,
  precheck: () => Promise<void>,
): Promise<void> {
  await precheck();
  await applyInlineAssignSite(repo, ownerUserId, input, clock);
}
