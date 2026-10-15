import { describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "../src/lib/db-errors";

describe("unique constraint detection", () => {
  it("recognises D1 unique failures without treating other errors as duplicates", () => {
    expect(isUniqueConstraintError(new Error("D1_ERROR: UNIQUE constraint failed: time_entry.owner_user_id, time_entry.contractor_id, time_entry.site_id, time_entry.work_date"))).toBe(true);
    expect(isUniqueConstraintError(new Error("not_found"))).toBe(false);
    expect(isUniqueConstraintError("UNIQUE constraint failed: assignment_owner_contractor_site_uq")).toBe(true);
  });

  it("reads a Drizzle cause chain and ignores a business_required abort", () => {
    expect(isUniqueConstraintError(new Error("Failed query: insert into site\nparams: []", {
      cause: new Error("UNIQUE constraint failed: site.owner_user_id, site.name"),
    }))).toBe(true);
    expect(isUniqueConstraintError(new Error("Failed query: insert", {
      cause: new Error("business_required"),
    }))).toBe(false);
    expect(isUniqueConstraintError({
      message: "Failed query: insert into contractor\nparams: []",
      cause: { message: "UNIQUE constraint failed: contractor.owner_user_id, contractor.name" },
    })).toBe(true);

    let nested: unknown = new Error("UNIQUE constraint failed: site.owner_user_id, site.name");
    for (let depth = 0; depth < 5; depth += 1) {
      nested = { message: "Failed query: insert", cause: nested };
    }
    expect(isUniqueConstraintError(nested)).toBe(true);
  });
});
