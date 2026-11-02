import { env } from "cloudflare:workers";
import { ownerAssistantConfirmInputSchema } from "@cleantrack/core/owner-assistant";
import { db } from "@/db/client";
import { noStoreJson } from "@/lib/accounts-config";
import { apiError, authorize, readJson } from "@/lib/api";
import { confirmOwnerAssistantAction } from "@/services/owner-assistant";

export async function POST(request: Request) {
  const access = await authorize(request, true);
  if ("response" in access) return access.response;
  try {
    const input = ownerAssistantConfirmInputSchema.parse(await readJson(request));
    return noStoreJson(await confirmOwnerAssistantAction(db, access.user, input.token, env.BETTER_AUTH_SECRET));
  } catch (error) {
    return apiError(error, request);
  }
}
