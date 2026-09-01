import type {
  AssignmentClock,
  AssignmentPatch,
  AssignmentRecord,
  AssignmentRepository,
  ContractorRecord,
  JoinedAssignment,
  SiteRecord,
} from "../src/lib/assignment";

export type MemoryTimeEntry = {
  id: string;
  ownerUserId: string;
  contractorId: string;
  siteId: string;
  rateCents: number;
};

export class MemoryTimesheetStore implements AssignmentRepository {
  contractors = new Map<string, ContractorRecord>();
  sites = new Map<string, SiteRecord>();
  assignments = new Map<string, AssignmentRecord>();
  entries: MemoryTimeEntry[] = [];

  seedContractor(row: ContractorRecord) {
    this.contractors.set(row.id, { ...row });
  }

  seedSite(row: SiteRecord) {
    this.sites.set(row.id, { ...row });
  }

  seedAssignment(row: AssignmentRecord) {
    this.assignments.set(row.id, { ...row });
  }

  snapshotAssignments() {
    return [...this.assignments.values()].map((row) => ({ ...row }));
  }

  async getContractor(ownerUserId: string, contractorId: string) {
    const row = this.contractors.get(contractorId);
    if (!row || row.ownerUserId !== ownerUserId) return undefined;
    return { ...row };
  }

  async getSite(ownerUserId: string, siteId: string) {
    const row = this.sites.get(siteId);
    if (!row || row.ownerUserId !== ownerUserId) return undefined;
    return { ...row };
  }

  async getAssignmentByPair(ownerUserId: string, contractorId: string, siteId: string) {
    const row = [...this.assignments.values()].find((assignment) => (
      assignment.ownerUserId === ownerUserId
      && assignment.contractorId === contractorId
      && assignment.siteId === siteId
    ));
    return row ? { ...row } : undefined;
  }

  async getAssignmentById(ownerUserId: string, assignmentId: string) {
    const row = this.assignments.get(assignmentId);
    if (!row || row.ownerUserId !== ownerUserId) return undefined;
    return { ...row };
  }

  async insertAssignment(row: AssignmentRecord) {
    const exists = [...this.assignments.values()].some((assignment) => (
      assignment.ownerUserId === row.ownerUserId
      && assignment.contractorId === row.contractorId
      && assignment.siteId === row.siteId
    ));
    if (exists) throw new Error("UNIQUE constraint failed: assignment_owner_contractor_site_uq");
    this.assignments.set(row.id, { ...row });
  }

  async updateAssignment(ownerUserId: string, assignmentId: string, patch: AssignmentPatch) {
    const row = this.assignments.get(assignmentId);
    if (!row || row.ownerUserId !== ownerUserId) return;
    const next = { ...row, updatedAt: patch.updatedAt };
    if (patch.active !== undefined) next.active = patch.active;
    if (Object.prototype.hasOwnProperty.call(patch, "rateCents")) next.rateCents = patch.rateCents as number | null;
    this.assignments.set(assignmentId, next);
  }

  async listJoinedAssignments(ownerUserId: string): Promise<JoinedAssignment[]> {
    const rows: JoinedAssignment[] = [];
    for (const assignment of this.assignments.values()) {
      if (assignment.ownerUserId !== ownerUserId) continue;
      const contractor = this.contractors.get(assignment.contractorId);
      const site = this.sites.get(assignment.siteId);
      if (!contractor || contractor.ownerUserId !== ownerUserId) continue;
      if (!site || site.ownerUserId !== ownerUserId) continue;
      rows.push(joinRow(assignment, contractor, site));
    }
    rows.sort((a, b) => a.contractorName.localeCompare(b.contractorName) || a.siteName.localeCompare(b.siteName));
    return rows;
  }

  async getJoinedAssignment(ownerUserId: string, assignmentId: string) {
    const assignment = await this.getAssignmentById(ownerUserId, assignmentId);
    if (!assignment) return undefined;
    const contractor = await this.getContractor(ownerUserId, assignment.contractorId);
    const site = await this.getSite(ownerUserId, assignment.siteId);
    if (!contractor || !site) return undefined;
    return joinRow(assignment, contractor, site);
  }
}

function joinRow(assignment: AssignmentRecord, contractor: ContractorRecord, site: SiteRecord): JoinedAssignment {
  return {
    id: assignment.id,
    contractorId: assignment.contractorId,
    contractorName: contractor.name,
    contractorDefaultRateCents: contractor.defaultRateCents,
    contractorActive: contractor.active,
    siteId: assignment.siteId,
    siteName: site.name,
    siteActive: site.active,
    rateCents: assignment.rateCents,
    active: assignment.active,
    createdAt: assignment.createdAt,
    updatedAt: assignment.updatedAt,
  };
}

export function testClock(start = Date.UTC(2026, 8, 1)): AssignmentClock {
  let n = 0;
  let t = start;
  return {
    id: () => `asg-${++n}`,
    now: () => new Date(t += 1_000),
  };
}

export function snapshotRate(store: MemoryTimesheetStore, ownerUserId: string, contractorId: string, siteId: string): number {
  const assignment = [...store.assignments.values()].find((row) => (
    row.ownerUserId === ownerUserId && row.contractorId === contractorId && row.siteId === siteId
  ));
  const contractor = store.contractors.get(contractorId);
  const site = store.sites.get(siteId);
  if (!assignment?.active || contractor?.ownerUserId !== ownerUserId || !contractor.active || site?.ownerUserId !== ownerUserId || !site.active) {
    throw new Error("not_found");
  }
  return assignment.rateCents ?? contractor.defaultRateCents;
}
