import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/accounts-config";
import { readOpsJson, withOps } from "@/lib/ops-http";
import { opsSqlPreviewInput } from "@/lib/ops-input";
import { d1OpsRunner } from "@/lib/ops-sql";
import { opsPreviewSql } from "@/services/ops";

export async function POST(request: Request) {
  return withOps(request, async (auth) => {
    const parsed = opsSqlPreviewInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsPreviewSql(d1OpsRunner(env.DB), {
      sql: parsed.data.sql,
      params: parsed.data.params,
      secret: auth.token,
      nowMs: Date.now(),
    }));
  });
}
