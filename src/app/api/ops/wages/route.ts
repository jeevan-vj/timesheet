import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { withOps } from "@/lib/ops-http";
import { opsWagesQueryInput } from "@/lib/ops-input";
import { opsWages } from "@/services/ops";

export async function GET(request: Request) {
  return withOps(request, async () => {
    const url = new URL(request.url);
    const parsed = opsWagesQueryInput.safeParse({
      ownerUserId: url.searchParams.get("ownerUserId") ?? undefined,
      week: url.searchParams.get("week") ?? undefined,
      contractorId: url.searchParams.get("contractorId") ?? undefined,
      siteId: url.searchParams.get("siteId") ?? undefined,
    });
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsWages(db, {
      ownerUserId: parsed.data.ownerUserId,
      weekStart: parsed.data.week,
      contractorId: parsed.data.contractorId,
      siteId: parsed.data.siteId,
    }));
  });
}
