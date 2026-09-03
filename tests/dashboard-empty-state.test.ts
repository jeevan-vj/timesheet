import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("weekly dashboard empty-state copy", () => {
  const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");

  it("keeps the empty-week heading and tells owners to record the first shift after contractor and site assignment", () => {
    expect(dashboard).toContain('title="No shifts this week"');
    expect(dashboard).toContain(
      'body="Record the first shift after adding a contractor and assigning them to a site."',
    );
    expect(dashboard).toMatch(
      /data\.entries\.length \?[\s\S]*: <EmptyState title="No shifts this week" body="Record the first shift after adding a contractor and assigning them to a site\." \/>/,
    );
    expect(dashboard).not.toContain("Add the first daily shift once you have a contractor and a site.");
  });

  it("keeps the populated week table path and EmptyState structure unchanged", () => {
    expect(dashboard).toContain("table-wrap");
    expect(dashboard).toContain("ShiftRow");
    expect(dashboard).toContain("<th>Date</th>");
    expect(dashboard).toContain("<th>Contractor</th>");
    expect(dashboard).toContain("<th>Site</th>");
    expect(dashboard).toContain("<th>Shift</th>");
    expect(dashboard).toContain("<th>Paid</th>");
    expect(dashboard).toContain("<th>Pay</th>");
    expect(dashboard).toContain("<h3>{title}</h3>");
    expect(dashboard).toContain("<p>{body}</p>");
    expect(dashboard).toContain("Payment totals appear as shifts are added.");
    expect(dashboard).not.toContain("owner_user_id");
    expect(dashboard).toContain("Approve week");
    expect(dashboard).toContain("Reopen week");
    expect(dashboard).toContain("Approved / locked");
  });
});
