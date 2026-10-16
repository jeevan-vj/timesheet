import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { isOpsId, readOpsJson, withOps } from "@/lib/ops-http";
import { parseOpsTimeEntryUpdate } from "@/lib/ops-input";
import { opsUpdateTimeEntry } from "@/services/ops";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withOps(request, async () => {
    const { id } = await context.params;
    if (!isOpsId(id)) return noStoreJson({ error: "invalid_request" }, 400);
    const parsed = parseOpsTimeEntryUpdate(await readOpsJson(request));
    if (!parsed) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsUpdateTimeEntry(db, id, parsed));
  });
}
