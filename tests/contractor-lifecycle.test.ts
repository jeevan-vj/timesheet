import { describe, expect, it } from "vitest";
import {
  archiveWritePlan,
  contractorNameConflicts,
  contractorUpdateWriteSet,
  contractorVisibleInList,
  dashboardAssignmentsForSelect,
  mapContractorWriteError,
  parseIncludeArchived,
  requireOwnedContractor,
  restoreWritePlan,
  toContractorResource,
} from "../src/lib/contractor-lifecycle";

const owner = "owner-1";
const other = "owner-2";

const row = {
  id: "c1",
  ownerUserId: owner,
  name: "Aroha",
  email: "a@example.test",
  phone: "021000000",
  defaultRateCents: 3_200,
  currency: "NZD" as const,
  active: true,
  createdAt: new Date("2026-08-31T00:00:00.000Z"),
  updatedAt: new Date("2026-09-01T12:00:00.000Z"),
};

describe("includeArchived query parsing", () => {
  it("treats omit, false, and 0 as active-only", () => {
    expect(parseIncludeArchived(null)).toEqual({ ok: true, includeArchived: false });
    expect(parseIncludeArchived("")).toEqual({ ok: true, includeArchived: false });
    expect(parseIncludeArchived("false")).toEqual({ ok: true, includeArchived: false });
    expect(parseIncludeArchived("0")).toEqual({ ok: true, includeArchived: false });
  });

  it("treats true and 1 as active plus archived", () => {
    expect(parseIncludeArchived("true")).toEqual({ ok: true, includeArchived: true });
    expect(parseIncludeArchived("1")).toEqual({ ok: true, includeArchived: true });
  });

  it("rejects any other query value", () => {
    expect(parseIncludeArchived("yes")).toEqual({ ok: false });
    expect(parseIncludeArchived("TRUE")).toEqual({ ok: false });
    expect(parseIncludeArchived("2")).toEqual({ ok: false });
  });
});

describe("list visibility", () => {
  it("hides archived contractors unless includeArchived is set", () => {
    expect(contractorVisibleInList({ active: true }, false)).toBe(true);
    expect(contractorVisibleInList({ active: false }, false)).toBe(false);
    expect(contractorVisibleInList({ active: true }, true)).toBe(true);
    expect(contractorVisibleInList({ active: false }, true)).toBe(true);
  });
});

describe("name conflict", () => {
  const existing = [
    { id: "c1", ownerUserId: owner, name: "Aroha" },
    { id: "c2", ownerUserId: owner, name: "Mika" },
    { id: "c3", ownerUserId: other, name: "Aroha" },
    { id: "c4", ownerUserId: owner, name: "Archived Sam" },
  ];

  it("detects a trimmed same-owner name, including archived rows, and excludes self on rename", () => {
    expect(contractorNameConflicts({ ownerUserId: owner, name: "  Aroha  ", existing })).toBe(true);
    expect(contractorNameConflicts({ ownerUserId: owner, name: "Archived Sam", existing })).toBe(true);
    expect(contractorNameConflicts({ ownerUserId: owner, name: "Aroha", existing, excludeId: "c1" })).toBe(false);
    expect(contractorNameConflicts({ ownerUserId: owner, name: "Mika", existing, excludeId: "c1" })).toBe(true);
  });

  it("allows the same name for a different owner", () => {
    expect(contractorNameConflicts({ ownerUserId: other, name: "Mika", existing })).toBe(false);
    expect(contractorNameConflicts({ ownerUserId: other, name: "Aroha", existing, excludeId: "c3" })).toBe(false);
  });
});

describe("archive and restore write plans", () => {
  it("archives assignments first then the contractor, never writing time_entry", () => {
    const plan = archiveWritePlan(owner, "c1");
    expect(plan.map((step) => step.table)).toEqual(["assignment", "contractor"]);
    expect(plan.every((step) => step.action === "update")).toBe(true);
    expect(plan[0]).toMatchObject({ set: { active: false }, where: { ownerUserId: owner, contractorId: "c1" } });
    expect(plan[1]).toMatchObject({ set: { active: false }, where: { ownerUserId: owner, id: "c1" } });
    expect(plan.some((step) => "table" in step && (step.table as string) === "time_entry")).toBe(false);
  });

  it("restores the same contractor row first then assignments, and never inserts", () => {
    const plan = restoreWritePlan(owner, "c1");
    expect(plan.map((step) => step.table)).toEqual(["contractor", "assignment"]);
    expect(plan.every((step) => step.action === "update")).toBe(true);
    expect(plan[0]).toMatchObject({ set: { active: true }, where: { ownerUserId: owner, id: "c1" } });
    expect(plan[1]).toMatchObject({ set: { active: true }, where: { ownerUserId: owner, contractorId: "c1" } });
    expect(JSON.stringify(plan)).not.toMatch(/time_entry|insert/i);
  });

  it("throws not_found without a write plan when the owner-scoped contractor is missing", () => {
    expect(() => requireOwnedContractor(undefined)).toThrow("not_found");
    expect(requireOwnedContractor(row)).toBe(row);
  });
});

describe("rate update write set", () => {
  it("updates contractor profile fields only and never touches time_entry", () => {
    const updatedAt = new Date("2026-09-01T12:00:00.000Z");
    const set = contractorUpdateWriteSet({
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 4_000,
    }, updatedAt);
    expect(set).toEqual({
      name: "Aroha",
      email: "",
      phone: "",
      defaultRateCents: 4_000,
      updatedAt,
    });
    expect(set).not.toHaveProperty("rateCents");
    expect(set).not.toHaveProperty("ownerUserId");
    expect(set).not.toHaveProperty("active");
    expect(JSON.stringify(set)).not.toMatch(/time_entry/);
  });
});

describe("contractor resource mapping", () => {
  it("strips ownerUserId and serializes timestamps as JSON dates", () => {
    const resource = toContractorResource(row);
    expect(resource).not.toHaveProperty("ownerUserId");
    expect(resource).toEqual({
      id: "c1",
      name: "Aroha",
      email: "a@example.test",
      phone: "021000000",
      defaultRateCents: 3_200,
      currency: "NZD",
      active: true,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
    expect(JSON.parse(JSON.stringify(resource))).toMatchObject({
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    });
  });
});

describe("unique write errors", () => {
  it("maps the contractor name unique constraint to duplicate_contractor", () => {
    expect(() => mapContractorWriteError(new Error("UNIQUE constraint failed: contractor.owner_user_id, contractor.name"))).toThrow("duplicate_contractor");
    expect(() => mapContractorWriteError(new Error("not_found"))).toThrow("not_found");
    expect(() => mapContractorWriteError(new Error("Failed query: insert into contractor\nparams: []", {
      cause: new Error("UNIQUE constraint failed: contractor.owner_user_id, contractor.name"),
    }))).toThrow("duplicate_contractor");
    expect(() => mapContractorWriteError(new Error("Failed query: insert", {
      cause: new Error("business_required"),
    }))).toThrow("Failed query: insert");
  });
});

describe("dashboard assignment visibility", () => {
  it("lists only active assignments whose contractor is also active", () => {
    const assignments = [
      { id: "a1", contractorId: "c1", siteId: "s1", active: true },
      { id: "a2", contractorId: "c2", siteId: "s1", active: true },
      { id: "a3", contractorId: "c1", siteId: "s2", active: false },
    ];
    const contractors = [
      { id: "c1", active: true },
      { id: "c2", active: false },
    ];
    expect(dashboardAssignmentsForSelect(assignments, contractors).map((row) => row.id)).toEqual(["a1"]);
  });
});
