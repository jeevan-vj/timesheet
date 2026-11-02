import type { Database as SqlJsDatabase } from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmOwnerAssistantAction, prepareOwnerAssistantResponse } from "../src/services/owner-assistant";
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
});
