import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmOwnerAssistantAction,
  ownerAssistantPlanFromForm,
  prepareOwnerAssistantResponse,
} from "../src/services/owner-assistant";
import { createSite } from "../src/services/sites";
import { createAssignment, createContractor, createTimeEntry } from "../src/services/timesheet";
import { seedOwnerWorkspace } from "./owner-workspace";
import { openPortalSqlite, portalDatabase, sqlRows } from "./portal-db";

type Database = Parameters<typeof prepareOwnerAssistantResponse>[0];
const SECRET = "owner-assistant-test-secret";

describe("owner assistant service", () => {
  let sqlite: SqlJsDatabase;
  let database: Database;

  beforeEach(async () => {
    sqlite = await openPortalSqlite();
    seedOwnerWorkspace(sqlite, "owner-a");
    seedOwnerWorkspace(sqlite, "owner-b");
    database = portalDatabase<Database>(sqlite);
  });

  it("previews, owner-binds, consumes once, and executes through the existing site service", async () => {
    const response = await prepareOwnerAssistantResponse(database, { id: "owner-a", name: "Owner A", email: "owner-a@example.test" }, {
      intent: "create_site", reply: "I prepared the site.", name: "Whitford", address: "1 Demo Road",
    }, SECRET);
    expect(response.kind).toBe("preview");
    if (response.kind !== "preview") throw new Error("expected preview");

    await expect(confirmOwnerAssistantAction(database, { id: "owner-b" }, response.confirmation.token, SECRET)).rejects.toThrow("confirm_mismatch");
    expect(sqlRows(sqlite, "SELECT COUNT(*) FROM site WHERE owner_user_id = 'owner-b'")).toEqual([[0]]);

    const receipt = await confirmOwnerAssistantAction(database, { id: "owner-a" }, response.confirmation.token, SECRET);
    expect(receipt).toMatchObject({ kind: "receipt", action: "create_site", message: "Whitford was created." });
    expect(sqlRows(sqlite, "SELECT owner_user_id, business_id, name, address FROM site")).toEqual([["owner-a", "biz_owner-a", "Whitford", "1 Demo Road"]]);
    expect(sqlRows(sqlite, "SELECT owner_user_id, action FROM owner_assistant_confirmation")).toEqual([["owner-a", "create_site"]]);
    await expect(confirmOwnerAssistantAction(database, { id: "owner-a" }, response.confirmation.token, SECRET)).rejects.toThrow("confirm_used");
  });

  it("explains an empty remittance week and guides the owner to the next action", async () => {
    await createContractor(database, "owner-a", {
      name: "Akila",
      email: "",
      phone: "",
      defaultRateCents: 3_200,
    });

    const response = await prepareOwnerAssistantResponse(database, {
      id: "owner-a",
      name: "Owner A",
      email: "owner-a@example.test",
    }, {
      intent: "get_remittance",
      reply: "I will check Akila's remittance.",
      contractorName: "Akila",
      weekStart: "2026-10-26",
    }, SECRET);

    expect(response).toEqual({
      kind: "message",
      message: "Akila has no recorded shifts for 26 Oct – 1 Nov, so CleanTrack cannot calculate a remittance yet. Open Week and record the completed shifts. If you use a repeating schedule, apply it for that week first and confirm each shift is correct. Then ask me to check the remittance again.",
    });
  });

  it("builds guided assignment controls from only the session owner's active records", async () => {
    await createContractor(database, "owner-a", { name: "Akila", email: "", phone: "", defaultRateCents: 3_200 });
    await createContractor(database, "owner-b", { name: "Foreign contractor", email: "", phone: "", defaultRateCents: 4_000 });
    await createSite(database, "owner-a", { name: "Harbour", address: "1 Quay Street" });
    await createSite(database, "owner-b", { name: "Foreign site", address: "2 Other Street" });

    const response = await prepareOwnerAssistantResponse(database, {
      id: "owner-a",
      name: "Owner A",
      email: "owner-a@example.test",
    }, {
      intent: "clarify",
      reply: "Choose the contractor and site.",
      operation: "assign_site",
    }, SECRET);

    expect(response).toEqual({
      kind: "input",
      message: "Choose the contractor and site.",
      input: {
        operation: "assign_site",
        contractors: [{ label: "Akila", value: "Akila" }],
        sites: [{ label: "Harbour", value: "Harbour" }],
      },
    });
  });

  async function recordAkilaShift() {
    const contractor = await createContractor(database, "owner-a", {
      name: "Akila",
      email: "",
      phone: "",
      defaultRateCents: 3_200,
    });
    const site = await createSite(database, "owner-a", { name: "Harbour", address: "" });
    await createAssignment(database, "owner-a", { contractorId: contractor.id, siteId: site.id, rateCents: 3_200 });
    await createTimeEntry(database, "owner-a", {
      entryMode: "paid_hours",
      contractorId: contractor.id,
      siteId: site.id,
      workDate: "2026-10-26",
      paidMinutes: 60,
      notes: "",
    });
  }

  function remittancePlan() {
    return {
      intent: "get_remittance" as const,
      reply: "I will check Akila's remittance.",
      contractorName: "Akila",
      weekStart: "2026-10-26",
    };
  }

  it("uses the owner business name and contact email on a remittance", async () => {
    sqlite.run("UPDATE business SET name = ?, contact_email = ? WHERE id = ?", ["Northwind Cleaning", "office@northwind.test", "biz_owner-a"]);
    sqlite.run("UPDATE business SET name = ?, contact_email = ? WHERE id = ?", ["Harbour Crew", "accounts@harbour.test", "biz_owner-b"]);
    await recordAkilaShift();

    const response = await prepareOwnerAssistantResponse(database, {
      id: "owner-a",
      name: "Personal Owner",
      email: "personal@example.test",
    }, remittancePlan(), SECRET);

    expect(response.kind).toBe("remittance");
    if (response.kind !== "remittance") throw new Error("expected remittance");
    expect(response.remittance).toMatchObject({
      remitterName: "Northwind Cleaning",
      remitterEmail: "office@northwind.test",
    });
    expect(JSON.stringify(response)).not.toContain("Harbour Crew");
    expect(JSON.stringify(response)).not.toContain("accounts@harbour.test");
    expect(JSON.stringify(response)).not.toContain("Personal Owner");
    expect(JSON.stringify(response)).not.toContain("personal@example.test");
  });

  it("falls back to the session owner when business remitter fields are blank", async () => {
    sqlite.run("UPDATE business SET name = ?, contact_email = ? WHERE id = ?", ["Northwind Cleaning", "", "biz_owner-a"]);
    await recordAkilaShift();
    const owner = { id: "owner-a", name: "Personal Owner", email: "personal@example.test" };

    const partial = await prepareOwnerAssistantResponse(database, owner, remittancePlan(), SECRET);
    expect(partial.kind).toBe("remittance");
    if (partial.kind !== "remittance") throw new Error("expected remittance");
    expect(partial.remittance).toMatchObject({
      remitterName: "Northwind Cleaning",
      remitterEmail: "personal@example.test",
    });

    sqlite.run("UPDATE business SET name = '', contact_email = '' WHERE id = 'biz_owner-a'");
    const fallback = await prepareOwnerAssistantResponse(database, owner, remittancePlan(), SECRET);
    expect(fallback.kind).toBe("remittance");
    if (fallback.kind !== "remittance") throw new Error("expected remittance");
    expect(fallback.remittance).toMatchObject({
      remitterName: "Personal Owner",
      remitterEmail: "personal@example.test",
    });

    const missing = await prepareOwnerAssistantResponse(database, {
      id: "owner-a",
      name: "   ",
      email: "",
    }, remittancePlan(), SECRET);
    expect(missing).toEqual({
      kind: "message",
      message: "Complete the owner name and email before requesting a remittance.",
    });
  });

  it("maps every validated guided form to the existing assistant plans", () => {
    expect(ownerAssistantPlanFromForm({
      operation: "create_contractor",
      name: "Akila",
      email: "akila@example.test",
      phone: "021000000",
      defaultRateCents: 3_200,
    })).toMatchObject({
      intent: "create_contractor",
      operation: null,
      name: "Akila",
      defaultRateCents: 3_200,
    });
    expect(ownerAssistantPlanFromForm({
      operation: "create_site",
      name: "Harbour",
      address: "1 Quay Street",
    })).toMatchObject({ intent: "create_site", operation: null, name: "Harbour" });
    expect(ownerAssistantPlanFromForm({
      operation: "assign_site",
      contractorName: "Akila",
      siteName: "Harbour",
      rateCents: null,
    })).toMatchObject({ intent: "assign_site", operation: null, contractorName: "Akila", siteName: "Harbour" });
    expect(ownerAssistantPlanFromForm({
      operation: "get_remittance",
      contractorName: "Akila",
      weekStart: "2026-10-26",
    })).toEqual({
      intent: "get_remittance",
      operation: null,
      reply: "I will verify Akila's remittance for the selected week.",
      contractorName: "Akila",
      weekStart: "2026-10-26",
    });
  });
});
