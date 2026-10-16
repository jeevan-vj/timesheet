import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { opsCreateContractorInput } from "@/lib/ops-input";
import { readOpsJson, withOps } from "@/lib/ops-http";
import { opsCreateContractor } from "@/services/ops";

export async function POST(request: Request) {
  return withOps(request, async () => {
    const parsed = opsCreateContractorInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsCreateContractor(db, parsed.data), 201);
  });
}
