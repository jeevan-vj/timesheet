import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmOwnerAssistantAction, prepareOwnerAssistantResponse } from "../src/services/owner-assistant";
import { createContractor } from "../src/services/timesheet";
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
});
