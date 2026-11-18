import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { calculateEntryPayCents } from "../src/lib/payroll";
import { getPortalWeekRemittance } from "../src/services/portal";
import { createSite } from "../src/services/sites";
import { createAssignment, createContractor, createTimeEntry } from "../src/services/timesheet";
import { approveWeek } from "../src/services/week-approval";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase } from "./portal-db";

type Database = Parameters<typeof getPortalWeekRemittance>[0];

const weekStart = "2026-10-26";
const paidMinutes = 60;
const rateCents = 3_200;

describe("portal remittance remitter", () => {
  let sqlite: SqlJsDatabase;
  let database: Database;

  beforeEach(async () => {
    sqlite = await openPortalSqlite();
    database = portalDatabase<Database>(sqlite);
    sqlite.run(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, 1700000000, 1700000000)",
      ["contractor-user", "Aroha Contractor", "aroha@example.test"],
    );
  });

  async function approvedLink(input: {
    ownerUserId: string;
    ownerName: string;
    ownerEmail: string;
    businessName: string;
    contactEmail: string;
    contractorName: string;
  }) {
    seedOwnerWorkspace(sqlite, input.ownerUserId, { name: input.ownerName, email: input.ownerEmail });
    sqlite.run(
      "UPDATE business SET name = ?, contact_email = ? WHERE id = ?",
      [input.businessName, input.contactEmail, `biz_${input.ownerUserId}`],
    );
    const contractor = await createContractor(database, input.ownerUserId, {
      name: input.contractorName,
      email: "",
      phone: "",
      defaultRateCents: rateCents,
    });
    const site = await createSite(database, input.ownerUserId, { name: `${input.businessName} site`, address: "" });
    await createAssignment(database, input.ownerUserId, {
      contractorId: contractor.id,
      siteId: site.id,
      rateCents,
    });
    await createTimeEntry(database, input.ownerUserId, {
      entryMode: "paid_hours",
      contractorId: contractor.id,
      siteId: site.id,
      workDate: weekStart,
      paidMinutes,
      notes: "",
    });
    await approveWeek(database, input.ownerUserId, {
      weekStart,
      expectedPaidMinutes: paidMinutes,
      expectedPayCents: calculateEntryPayCents(paidMinutes, rateCents),
    });
    sqlite.run(
      `INSERT INTO contractor_account (
        id, business_id, owner_user_id, contractor_id, user_id, active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'contractor-user', 1, 1700000000, 1700000000)`,
      [`acct-${input.ownerUserId}`, `biz_${input.ownerUserId}`, input.ownerUserId, contractor.id],
    );
  }

  it("uses each linked business name and contact email", async () => {
    await approvedLink({
      ownerUserId: "owner-a",
      ownerName: "Personal A",
      ownerEmail: "personal-a@example.test",
      businessName: "Northwind Cleaning",
      contactEmail: "office@northwind.test",
      contractorName: "Aroha North",
    });
    await approvedLink({
      ownerUserId: "owner-b",
      ownerName: "Personal B",
      ownerEmail: "personal-b@example.test",
      businessName: "Harbour Crew",
      contactEmail: "accounts@harbour.test",
      contractorName: "Aroha Harbour",
    });

    const northwind = await getPortalWeekRemittance(database, "contractor-user", "biz_owner-a", weekStart);
    expect(northwind).toMatchObject({
      remitterName: "Northwind Cleaning",
      remitterEmail: "office@northwind.test",
    });
    expect(JSON.stringify(northwind)).not.toContain("Personal A");
    expect(JSON.stringify(northwind)).not.toContain("personal-a@example.test");
    expect(JSON.stringify(northwind)).not.toContain("Aroha Contractor");
    expect(JSON.stringify(northwind)).not.toContain("aroha@example.test");

    const harbour = await getPortalWeekRemittance(database, "contractor-user", "biz_owner-b", weekStart);
    expect(harbour).toMatchObject({
      remitterName: "Harbour Crew",
      remitterEmail: "accounts@harbour.test",
    });
    expect(JSON.stringify(harbour)).not.toContain("office@northwind.test");
    await expect(getPortalWeekRemittance(database, "contractor-user", "biz_owner-c", weekStart)).rejects.toThrow("not_found");
  });

  it("falls back to that business owner when the business fields are blank", async () => {
    await approvedLink({
      ownerUserId: "owner-a",
      ownerName: "Personal A",
      ownerEmail: "personal-a@example.test",
      businessName: "Northwind Cleaning",
      contactEmail: " ",
      contractorName: "Aroha North",
    });
    await approvedLink({
      ownerUserId: "owner-b",
      ownerName: "Personal B",
      ownerEmail: "personal-b@example.test",
      businessName: "Harbour Crew",
      contactEmail: "accounts@harbour.test",
      contractorName: "Aroha Harbour",
    });

    const partial = await getPortalWeekRemittance(database, "contractor-user", "biz_owner-a", weekStart);
    expect(partial).toMatchObject({
      remitterName: "Northwind Cleaning",
      remitterEmail: "personal-a@example.test",
    });

    sqlite.run("UPDATE business SET name = '   ', contact_email = '' WHERE id = 'biz_owner-a'");
    const fallback = await getPortalWeekRemittance(database, "contractor-user", "biz_owner-a", weekStart);
    expect(fallback).toMatchObject({
      remitterName: "Personal A",
      remitterEmail: "personal-a@example.test",
    });
    const harbour = await getPortalWeekRemittance(database, "contractor-user", "biz_owner-b", weekStart);
    expect(harbour).toMatchObject({
      remitterName: "Harbour Crew",
      remitterEmail: "accounts@harbour.test",
    });
  });
});
