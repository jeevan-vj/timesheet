import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { readOpsJson, withOps } from "@/lib/ops-http";
import { opsRevertInput } from "@/lib/ops-input";
import { opsRevert } from "@/services/ops";

export async function POST(request: Request) {
  return withOps(request, async () => {
    const parsed = opsRevertInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsRevert(db, parsed.data));
  });
}
