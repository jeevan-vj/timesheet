import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { readOpsJson, withOps } from "@/lib/ops-http";
import { parseOpsTimeEntryCreate } from "@/lib/ops-input";
import { opsCreateTimeEntry } from "@/services/ops";

export async function POST(request: Request) {
  return withOps(request, async () => {
    const parsed = parseOpsTimeEntryCreate(await readOpsJson(request));
    if (!parsed) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsCreateTimeEntry(db, parsed), 201);
  });
}
