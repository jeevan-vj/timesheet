import { describe, expect, it } from "vitest";
import {
  applyInlineAssignSite,
  applyInlineAssignSiteAfterPrecheck,
  assignmentHttpStatus,
  inlineAssignmentIntent,
  isNewEntryAssignment,
  ownedRelationStatus,
  planAssignmentWrite,
  planRestoreAssignment,
  runCreateAssignment,
  runGetAssignment,
  runListAssignments,
  runRestoreAssignment,
  runUnassignAssignment,
  runUpdateAssignmentRate,
  toAssignmentView,
} from "../src/lib/assignment";
import { MemoryTimesheetStore, snapshotRate, testClock } from "./memory-timesheet-store";

const OWNER = "owner-1";
const OTHER = "owner-2";
const createdAt = new Date("2026-01-01T00:00:00.000Z");
const updatedAt = new Date("2026-01-02T00:00:00.000Z");

function seedActivePair(store: MemoryTimesheetStore, overrides: { contractorActive?: boolean; siteActive?: boolean; contractorOwner?: string; siteOwner?: string } = {}) {
  store.seedContractor({
    id: "c1",
    ownerUserId: overrides.contractorOwner ?? OWNER,
    name: "Aroha",
    defaultRateCents: 3_200,
    active: overrides.contractorActive ?? true,
  });
  store.seedSite({
    id: "s1",
    ownerUserId: overrides.siteOwner ?? OWNER,
    name: "Harbour Offices",
    active: overrides.siteActive ?? true,
  });
}

function archivedAssignment(store: MemoryTimesheetStore, rateCents: number | null = 4_000) {
  store.seedAssignment({
    id: "a1",
    ownerUserId: OWNER,
    contractorId: "c1",
    siteId: "s1",
    rateCents,
    active: false,
    createdAt,
    updatedAt,
  });
}

describe("assignment write plans", () => {
  it("inserts when the owned pair is active and no row exists", () => {
    expect(planAssignmentWrite({ contractor: "active", site: "active", existing: null })).toEqual({ type: "insert" });
  });

  it("rejects a second active assignment as duplicate_assignment", () => {
    expect(planAssignmentWrite({ contractor: "active", site: "active", existing: { id: "a1", active: true } })).toEqual({ type: "duplicate" });
  });

  it("restores an archived row when both relations are active", () => {
    expect(planAssignmentWrite({ contractor: "active", site: "active", existing: { id: "a1", active: false } })).toEqual({ type: "restore", id: "a1", applyRate: true });
  });

  it("returns not_found for inactive or missing contractor/site, including archived pairs", () => {
    expect(planAssignmentWrite({ contractor: "inactive", site: "active", existing: null }).type).toBe("not_found");
    expect(planAssignmentWrite({ contractor: "active", site: "missing", existing: { id: "a1", active: false } }).type).toBe("not_found");
    expect(planAssignmentWrite({ contractor: "missing", site: "active", existing: { id: "a1", active: false } }).type).toBe("not_found");
    expect(planAssignmentWrite({ contractor: "inactive", site: "active", existing: { id: "a1", active: true } }).type).toBe("not_found");
    expect(planAssignmentWrite({ contractor: "active", site: "inactive", existing: { id: "a1", active: true } }).type).toBe("not_found");
  });

  it("treats owner-scoped misses as missing rather than inactive", () => {
    expect(ownedRelationStatus(undefined)).toBe("missing");
    expect(ownedRelationStatus({ active: false })).toBe("inactive");
    expect(ownedRelationStatus({ active: true })).toBe("active");
  });
});

describe("restore-by-id plans", () => {
  it("reactivates an archived assignment when both entities are active", () => {
    expect(planRestoreAssignment({ assignment: { active: false }, contractor: "active", site: "active" })).toEqual({ type: "restore" });
  });

  it("returns the current row when already active without requiring a rewrite", () => {
    expect(planRestoreAssignment({ assignment: { active: true }, contractor: "inactive", site: "active" })).toEqual({ type: "noop" });
  });

  it("returns not_found when missing or when an archived pair has an inactive relation", () => {
    expect(planRestoreAssignment({ assignment: null, contractor: "active", site: "active" }).type).toBe("not_found");
    expect(planRestoreAssignment({ assignment: { active: false }, contractor: "inactive", site: "active" }).type).toBe("not_found");
    expect(planRestoreAssignment({ assignment: { active: false }, contractor: "active", site: "missing" }).type).toBe("not_found");
  });
});

describe("inline assignment intent", () => {
  it("uses an active assignment when assignSite is absent", () => {
    expect(inlineAssignmentIntent({
      assignSite: undefined,
      existing: { id: "a1", active: true, rateCents: 4_000 },
      contractor: "active",
      site: "active",
    })).toEqual({ type: "use_existing" });
  });

  it("is not_found when assignSite is absent and the pair is archived or missing", () => {
    expect(inlineAssignmentIntent({
      assignSite: undefined,
      existing: { id: "a1", active: false, rateCents: 4_000 },
      contractor: "active",
      site: "active",
    }).type).toBe("not_found");
    expect(inlineAssignmentIntent({
      assignSite: undefined,
      existing: null,
      contractor: "active",
      site: "active",
    }).type).toBe("not_found");
  });

  it("inserts a missing pair when assignSite is present", () => {
    expect(inlineAssignmentIntent({
      assignSite: { rateCents: 3_500 },
      existing: null,
      contractor: "active",
      site: "active",
    })).toEqual({ type: "insert", rateCents: 3_500 });
  });

  it("restores an archived pair and applies assignSite.rateCents including null", () => {
    expect(inlineAssignmentIntent({
      assignSite: { rateCents: null },
      existing: { id: "a1", active: false, rateCents: 4_000 },
      contractor: "active",
      site: "active",
    })).toEqual({ type: "restore", id: "a1", rateCents: null });
  });

  it("does not rewrite an already-active override when assignSite is present", () => {
    expect(inlineAssignmentIntent({
      assignSite: { rateCents: 9_999 },
      existing: { id: "a1", active: true, rateCents: 4_000 },
      contractor: "active",
      site: "active",
    })).toEqual({ type: "use_existing" });
  });

  it("does not restore when assignSite is present but a relation is inactive", () => {
    expect(inlineAssignmentIntent({
      assignSite: { rateCents: 3_500 },
      existing: { id: "a1", active: false, rateCents: 4_000 },
      contractor: "inactive",
      site: "active",
    }).type).toBe("not_found");
  });
});

describe("assignment views and dashboard visibility", () => {
  it("maps effectiveRateCents and rateInherited from the override or contractor default", () => {
    const inherited = toAssignmentView({
      id: "a1",
      contractorId: "c1",
      contractorName: "Aroha",
      contractorDefaultRateCents: 3_200,
      contractorActive: true,
      siteId: "s1",
      siteName: "Harbour Offices",
      siteActive: true,
      rateCents: null,
      active: true,
      createdAt,
      updatedAt,
    });
    expect(inherited).toMatchObject({
      rateCents: null,
      effectiveRateCents: 3_200,
      rateInherited: true,
    });
    expect(inherited).not.toHaveProperty("ownerUserId");

    const override = toAssignmentView({
      id: "a1",
      contractorId: "c1",
      contractorName: "Aroha",
      contractorDefaultRateCents: 3_200,
      contractorActive: true,
      siteId: "s1",
      siteName: "Harbour Offices",
      siteActive: true,
      rateCents: 4_100,
      active: false,
      createdAt,
      updatedAt,
    });
    expect(override).toMatchObject({
      rateCents: 4_100,
      effectiveRateCents: 4_100,
      rateInherited: false,
      active: false,
    });
  });

  it("keeps dashboard new-entry assignments only when assignment, contractor, and site are owned and active", () => {
    expect(isNewEntryAssignment({ assignmentActive: true, contractorOwned: true, contractorActive: true, siteOwned: true, siteActive: true })).toBe(true);
    expect(isNewEntryAssignment({ assignmentActive: false, contractorOwned: true, contractorActive: true, siteOwned: true, siteActive: true })).toBe(false);
    expect(isNewEntryAssignment({ assignmentActive: true, contractorOwned: true, contractorActive: false, siteOwned: true, siteActive: true })).toBe(false);
    expect(isNewEntryAssignment({ assignmentActive: true, contractorOwned: true, contractorActive: true, siteOwned: true, siteActive: false })).toBe(false);
    expect(isNewEntryAssignment({ assignmentActive: true, contractorOwned: false, contractorActive: true, siteOwned: true, siteActive: true })).toBe(false);
  });
});

describe("assignment HTTP error codes", () => {
  it("maps service errors to non-disclosing statuses used by the routes", () => {
    expect(assignmentHttpStatus("not_found")).toEqual({ status: 404, error: "not_found" });
    expect(assignmentHttpStatus("duplicate_assignment")).toEqual({ status: 409, error: "duplicate_assignment" });
    expect(assignmentHttpStatus("invalid_request")).toEqual({ status: 400, error: "invalid_request" });
  });
});

describe("assignment service lifecycle", () => {
  it("creates an assignment between an active owned contractor and site", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    const result = await runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 3_500 }, testClock());
    expect(result.created).toBe(true);
    expect(result).toMatchObject({
      contractorId: "c1",
      contractorName: "Aroha",
      siteId: "s1",
      siteName: "Harbour Offices",
      rateCents: 3_500,
      effectiveRateCents: 3_500,
      rateInherited: false,
      active: true,
    });
    expect(store.assignments.size).toBe(1);
  });

  it("does not insert when the contractor or site is inactive or foreign", async () => {
    const inactive = new MemoryTimesheetStore();
    seedActivePair(inactive, { contractorActive: false });
    await expect(runCreateAssignment(inactive, OWNER, { contractorId: "c1", siteId: "s1", rateCents: null }, testClock())).rejects.toThrow("not_found");
    expect(inactive.assignments.size).toBe(0);

    const foreign = new MemoryTimesheetStore();
    seedActivePair(foreign, { siteOwner: OTHER });
    await expect(runCreateAssignment(foreign, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 2_000 }, testClock())).rejects.toThrow("not_found");
    expect(foreign.assignments.size).toBe(0);
  });

  it("returns not_found rather than duplicate when an active assignment has an inactive relation", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store, { contractorActive: false });
    store.seedAssignment({ id: "a1", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 3_500, active: true, createdAt, updatedAt });
    const before = store.snapshotAssignments();
    await expect(runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 9_000 }, testClock())).rejects.toThrow("not_found");
    expect(store.snapshotAssignments()).toEqual(before);
  });

  it("rejects a second active create as duplicate_assignment without a second row", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    const clock = testClock();
    await runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 3_500 }, clock);
    const before = store.snapshotAssignments();
    await expect(runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 9_000 }, clock)).rejects.toThrow("duplicate_assignment");
    expect(store.snapshotAssignments()).toEqual(before);
  });

  it("maps an insert unique race to duplicate_assignment rather than invalid_request", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.insertAssignment = async () => {
      throw new Error("UNIQUE constraint failed: assignment_owner_contractor_site_uq");
    };
    await expect(runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: null }, testClock())).rejects.toThrow("duplicate_assignment");
  });

  it("reuses an archived pair id, sets active, and applies body rateCents including null", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    const result = await runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: null }, testClock());
    expect(result.created).toBe(false);
    expect(result).toMatchObject({
      id: "a1",
      rateCents: null,
      effectiveRateCents: 3_200,
      rateInherited: true,
      active: true,
      createdAt,
    });
    expect(store.assignments.size).toBe(1);
    expect(store.assignments.get("a1")?.createdAt).toEqual(createdAt);
  });

  it("does not restore an archived pair when a relation is inactive", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store, { siteActive: false });
    archivedAssignment(store);
    const before = store.snapshotAssignments();
    await expect(runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 2_200 }, testClock())).rejects.toThrow("not_found");
    expect(store.snapshotAssignments()).toEqual(before);
  });

  it("lists all owned assignments including archived, ordered by contractor then site name", async () => {
    const store = new MemoryTimesheetStore();
    store.seedContractor({ id: "c-b", ownerUserId: OWNER, name: "Mika", defaultRateCents: 2_800, active: true });
    store.seedContractor({ id: "c-a", ownerUserId: OWNER, name: "Aroha", defaultRateCents: 3_200, active: false });
    store.seedSite({ id: "s-z", ownerUserId: OWNER, name: "Quay", active: true });
    store.seedSite({ id: "s-a", ownerUserId: OWNER, name: "Arcade", active: false });
    store.seedAssignment({ id: "2", ownerUserId: OWNER, contractorId: "c-b", siteId: "s-z", rateCents: null, active: true, createdAt, updatedAt });
    store.seedAssignment({ id: "1", ownerUserId: OWNER, contractorId: "c-a", siteId: "s-a", rateCents: 4_000, active: false, createdAt, updatedAt });
    store.seedAssignment({ id: "x", ownerUserId: OTHER, contractorId: "c-b", siteId: "s-z", rateCents: 1, active: true, createdAt, updatedAt });
    const listed = await runListAssignments(store, OWNER);
    expect(listed.map((row) => row.id)).toEqual(["1", "2"]);
    expect(listed[0]).toMatchObject({ contractorName: "Aroha", siteName: "Arcade", active: false, rateInherited: false, effectiveRateCents: 4_000 });
    expect(listed[1]).toMatchObject({ contractorName: "Mika", siteName: "Quay", active: true, rateInherited: true, effectiveRateCents: 2_800 });
  });

  it("gets an owner-scoped assignment and hides other owners", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.seedAssignment({ id: "a1", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: null, active: true, createdAt, updatedAt });
    store.seedAssignment({ id: "other", ownerUserId: OTHER, contractorId: "c1", siteId: "s1", rateCents: 9_000, active: true, createdAt, updatedAt });
    await expect(runGetAssignment(store, OWNER, "a1")).resolves.toMatchObject({ id: "a1", contractorName: "Aroha" });
    await expect(runGetAssignment(store, OWNER, "other")).rejects.toThrow("not_found");
    await expect(runGetAssignment(store, OWNER, "missing")).rejects.toThrow("not_found");
  });

  it("patches an override on active or archived rows without touching time entries", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.seedAssignment({ id: "a1", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 3_500, active: true, createdAt, updatedAt });
    store.entries.push({ id: "te-old", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 3_500 });

    const patched = await runUpdateAssignmentRate(store, OWNER, "a1", 4_400, testClock());
    expect(patched).toMatchObject({ rateCents: 4_400, effectiveRateCents: 4_400, rateInherited: false });
    expect(store.entries[0]?.rateCents).toBe(3_500);

    const nextRate = snapshotRate(store, OWNER, "c1", "s1");
    expect(nextRate).toBe(4_400);
    store.entries.push({ id: "te-new", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: nextRate });
    expect(store.entries.map((entry) => entry.rateCents)).toEqual([3_500, 4_400]);

    await runUnassignAssignment(store, OWNER, "a1", testClock());
    const archivedPatch = await runUpdateAssignmentRate(store, OWNER, "a1", null, testClock());
    expect(archivedPatch).toMatchObject({ rateCents: null, rateInherited: true, effectiveRateCents: 3_200, active: false });
    expect(store.entries[0]?.rateCents).toBe(3_500);
  });

  it("uses the contractor default for the next entry after PATCH null, leaving old entries unchanged", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.seedAssignment({ id: "a1", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 4_000, active: true, createdAt, updatedAt });
    store.entries.push({ id: "te-old", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 4_000 });
    await runUpdateAssignmentRate(store, OWNER, "a1", null, testClock());
    expect(store.entries[0]?.rateCents).toBe(4_000);
    expect(snapshotRate(store, OWNER, "c1", "s1")).toBe(3_200);
  });

  it("unassigns by archiving, leaves time entries, and blocks a new entry without restore", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    const clock = testClock();
    await runCreateAssignment(store, OWNER, { contractorId: "c1", siteId: "s1", rateCents: 3_500 }, clock);
    store.entries.push({ id: "te-old", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 3_500 });
    const assignmentId = [...store.assignments.keys()][0]!;

    expect(await runUnassignAssignment(store, OWNER, assignmentId, clock)).toBe(true);
    expect(store.assignments.get(assignmentId)?.active).toBe(false);
    expect(store.entries[0]?.rateCents).toBe(3_500);
    expect(await runUnassignAssignment(store, OWNER, assignmentId, clock)).toBe(true);
    expect(() => snapshotRate(store, OWNER, "c1", "s1")).toThrow("not_found");
    expect(await runUnassignAssignment(store, OWNER, "missing", clock)).toBe(false);
  });

  it("restores by id when both entities are active and does not change rateCents", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    const restored = await runRestoreAssignment(store, OWNER, "a1", testClock());
    expect(restored).toMatchObject({ id: "a1", active: true, rateCents: 4_000, effectiveRateCents: 4_000 });
  });

  it("does not restore by id when either entity is inactive, and does not write", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store, { contractorActive: false });
    archivedAssignment(store, 4_000);
    const before = store.snapshotAssignments();
    await expect(runRestoreAssignment(store, OWNER, "a1", testClock())).rejects.toThrow("not_found");
    expect(store.snapshotAssignments()).toEqual(before);
  });

  it("returns not_found for a cross-owner assignment id on get, patch, unassign, and restore", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.seedContractor({ id: "c2", ownerUserId: OTHER, name: "Other", defaultRateCents: 2_000, active: true });
    store.seedSite({ id: "s2", ownerUserId: OTHER, name: "Other site", active: true });
    store.seedAssignment({ id: "foreign", ownerUserId: OTHER, contractorId: "c2", siteId: "s2", rateCents: 2_000, active: true, createdAt, updatedAt });
    const clock = testClock();
    await expect(runGetAssignment(store, OWNER, "foreign")).rejects.toThrow("not_found");
    await expect(runUpdateAssignmentRate(store, OWNER, "foreign", 2_200, clock)).rejects.toThrow("not_found");
    expect(await runUnassignAssignment(store, OWNER, "foreign", clock)).toBe(false);
    await expect(runRestoreAssignment(store, OWNER, "foreign", clock)).rejects.toThrow("not_found");
    expect(store.assignments.get("foreign")?.active).toBe(true);
    expect(store.assignments.get("foreign")?.rateCents).toBe(2_000);
  });

  it("restores an archived pair with assignSite and would snapshot that rate onto a new entry", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    const clock = testClock();
    await applyInlineAssignSite(store, OWNER, { contractorId: "c1", siteId: "s1", assignSite: { rateCents: 2_500 } }, clock);
    expect(store.assignments.get("a1")).toMatchObject({ active: true, rateCents: 2_500 });
    const entryRate = snapshotRate(store, OWNER, "c1", "s1");
    expect(entryRate).toBe(2_500);
    store.entries.push({ id: "te-new", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: entryRate });
    expect(store.entries).toHaveLength(1);
  });

  it("does not create an entry for an archived pair without assignSite", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    await applyInlineAssignSite(store, OWNER, { contractorId: "c1", siteId: "s1" }, testClock());
    const before = store.snapshotAssignments();
    expect(() => snapshotRate(store, OWNER, "c1", "s1")).toThrow("not_found");
    expect(store.snapshotAssignments()).toEqual(before);
    expect(store.entries).toHaveLength(0);
  });

  it("does not rewrite an already-active override when assignSite is present", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    store.seedAssignment({ id: "a1", ownerUserId: OWNER, contractorId: "c1", siteId: "s1", rateCents: 4_000, active: true, createdAt, updatedAt });
    await applyInlineAssignSite(store, OWNER, { contractorId: "c1", siteId: "s1", assignSite: { rateCents: 9_999 } }, testClock());
    expect(store.assignments.get("a1")?.rateCents).toBe(4_000);
    expect(snapshotRate(store, OWNER, "c1", "s1")).toBe(4_000);
  });

  it("does not restore an archived pair when time-entry precheck fails", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    await expect(applyInlineAssignSiteAfterPrecheck(
      store,
      OWNER,
      { contractorId: "c1", siteId: "s1", assignSite: { rateCents: 2_500 } },
      testClock(),
      async () => { throw new Error("duplicate_entry"); },
    )).rejects.toThrow("duplicate_entry");
    expect(store.assignments.get("a1")).toMatchObject({ active: false, rateCents: 4_000 });
  });

  it("restores an archived pair only after time-entry precheck succeeds", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store);
    archivedAssignment(store, 4_000);
    await applyInlineAssignSiteAfterPrecheck(
      store,
      OWNER,
      { contractorId: "c1", siteId: "s1", assignSite: { rateCents: 2_500 } },
      testClock(),
      async () => undefined,
    );
    expect(store.assignments.get("a1")).toMatchObject({ active: true, rateCents: 2_500 });
  });

  it("does not insert a time entry when inline restore/create fails", async () => {
    const store = new MemoryTimesheetStore();
    seedActivePair(store, { contractorActive: false });
    const before = store.snapshotAssignments();
    await expect(applyInlineAssignSite(store, OWNER, { contractorId: "c1", siteId: "s1", assignSite: { rateCents: 3_000 } }, testClock())).rejects.toThrow("not_found");
    expect(store.snapshotAssignments()).toEqual(before);
    expect(store.entries).toHaveLength(0);
  });
});
