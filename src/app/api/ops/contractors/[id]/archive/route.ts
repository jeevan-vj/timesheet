import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { isOpsId, readOpsJson, withOps } from "@/lib/ops-http";
import { opsOwnerReasonInput } from "@/lib/ops-input";
import { opsArchiveContractor } from "@/services/ops";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withOps(request, async () => {
    const { id } = await context.params;
    if (!isOpsId(id)) return noStoreJson({ error: "invalid_request" }, 400);
    const parsed = opsOwnerReasonInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsArchiveContractor(db, id, parsed.data));
  });
}
