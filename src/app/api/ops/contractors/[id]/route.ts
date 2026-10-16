import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { isOpsId, readOpsJson, withOps } from "@/lib/ops-http";
import { opsUpdateContractorInput } from "@/lib/ops-input";
import { opsUpdateContractor } from "@/services/ops";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withOps(request, async () => {
    const { id } = await context.params;
    if (!isOpsId(id)) return noStoreJson({ error: "invalid_request" }, 400);
    const parsed = opsUpdateContractorInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsUpdateContractor(db, id, parsed.data));
  });
}
