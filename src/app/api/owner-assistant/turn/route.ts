import { env } from "cloudflare:workers";
import { ownerAssistantTurnInputSchema } from "@cleantrack/core/owner-assistant";
import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError, authorize, readJson } from "@/lib/api";
import { planOwnerAssistantTurn } from "@/lib/owner-assistant-ai";
import { ownerAssistantPlanFromForm, prepareOwnerAssistantResponse } from "@/services/owner-assistant";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = ownerAssistantTurnInputSchema.parse(await readJson(request));
    const plan = input.form ? ownerAssistantPlanFromForm(input.form) : await planOwnerAssistantTurn(env.AI, input);
    return noStoreJson(await prepareOwnerAssistantResponse(db, access.user, plan, env.BETTER_AUTH_SECRET));
  } catch (error) {
    return apiError(error, request);
  }
}
