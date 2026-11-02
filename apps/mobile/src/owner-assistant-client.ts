import {
  ownerAssistantConfirmResponseSchema,
  ownerAssistantTurnResponseSchema,
  type OwnerAssistantFormSubmission,
  type OwnerAssistantHistoryMessage,
} from "@cleantrack/core";
import { mobileFetch } from "@/api";

async function post(path: string, body: unknown): Promise<unknown> {
  const response = await mobileFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(response.status === 503 ? "The assistant is temporarily unavailable." : "That request could not be completed.");
  return data;
}

export async function sendOwnerAssistantTurn(
  message: string,
  history: OwnerAssistantHistoryMessage[],
  form?: OwnerAssistantFormSubmission,
) {
  return ownerAssistantTurnResponseSchema.parse(await post("/api/owner-assistant/turn", { message, history, form }));
}

export async function confirmOwnerAssistantChange(token: string) {
  return ownerAssistantConfirmResponseSchema.parse(await post("/api/owner-assistant/confirm", { token }));
}
