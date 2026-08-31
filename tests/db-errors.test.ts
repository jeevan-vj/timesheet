import { describe, expect, it } from "vitest";
import { isUniqueConstraintError } from "../src/lib/db-errors";

describe("unique constraint detection", () => {
  it("recognises D1 unique failures without treating other errors as duplicates", () => {
    expect(isUniqueConstraintError(new Error("D1_ERROR: UNIQUE constraint failed: time_entry.owner_user_id, time_entry.contractor_id, time_entry.site_id, time_entry.work_date"))).toBe(true);
    expect(isUniqueConstraintError(new Error("not_found"))).toBe(false);
    expect(isUniqueConstraintError("UNIQUE constraint failed: assignment_owner_contractor_site_uq")).toBe(true);
  });
});
