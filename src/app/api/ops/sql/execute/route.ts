import { env } from "cloudflare:workers";
import { noStoreJson } from "@/lib/accounts-config";
import { readOpsJson, withOps } from "@/lib/ops-http";
import { opsSqlExecuteInput } from "@/lib/ops-input";
import { d1OpsRunner } from "@/lib/ops-sql";
import { opsExecuteSql } from "@/services/ops";

export async function POST(request: Request) {
  return withOps(request, async (auth) => {
    const parsed = opsSqlExecuteInput.safeParse(await readOpsJson(request));
    if (!parsed.success) return noStoreJson({ error: "invalid_request" }, 400);
    return noStoreJson(await opsExecuteSql(d1OpsRunner(env.DB), {
      sql: parsed.data.sql,
      params: parsed.data.params,
      confirmToken: parsed.data.confirmToken,
      reason: parsed.data.reason,
      secret: auth.token,
      nowMs: Date.now(),
    }));
  });
}
