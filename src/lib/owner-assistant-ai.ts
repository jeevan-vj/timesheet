import {
  OWNER_ASSISTANT_PLAN_JSON_SCHEMA,
  ownerAssistantPlanSchema,
  type OwnerAssistantPlan,
  type OwnerAssistantTurnInput,
} from "@cleantrack/core/owner-assistant";
import { portalCalendar } from "@cleantrack/core";

export const OWNER_ASSISTANT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

function responseValue(output: unknown): unknown {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "response" in output) return output.response;
  return null;
}

export function parseOwnerAssistantPlan(output: unknown): OwnerAssistantPlan {
  const response = responseValue(output);
  let candidate: unknown = response;
  if (typeof response === "string") {
    try { candidate = JSON.parse(response); } catch { throw new Error("assistant_unavailable"); }
  }
  const parsed = ownerAssistantPlanSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("assistant_unavailable");
  return parsed.data;
}

export async function planOwnerAssistantTurn(ai: Ai, input: OwnerAssistantTurnInput): Promise<OwnerAssistantPlan> {
  const calendar = portalCalendar();
  const system = [
    "You are the CleanTrack owner assistant for a New Zealand cleaning business.",
    "Choose exactly one supported intent. Never calculate pay, invent records, or request an owner id.",
    "Supported intents: create_contractor, create_site, assign_site, get_remittance, clarify.",
    "Writes are only previews; the server asks the owner to confirm. Ask a concise question with clarify when required information is missing.",
    "Always return operation. When clarify is for a supported operation, set it to that exact supported operation so CleanTrack can show trusted input controls. Otherwise set operation to null.",
    "For a remittance clarification, include a Monday weekStart when the requested week is already known.",
    "Contractor creation requires a name and hourly rate. Convert NZ dollar hourly rates to integer cents.",
    "Assignment requires exact contractor and site names. Use null rateCents to inherit the contractor default unless an override is explicit.",
    "Remittance requires an exact contractor name and a Monday weekStart. Resolve relative dates using Pacific/Auckland.",
    `Today is ${calendar.today} and the current Monday week is ${calendar.weekStart}.`,
    "Do not support shift edits, approval, archive, invitations, SQL, ops, tax, GST calculations, or payments; explain that limitation with clarify.",
    "Return only the JSON object. Keep reply under 500 characters.",
  ].join(" ");
  try {
    const output = await ai.run(OWNER_ASSISTANT_MODEL, {
      messages: [
        { role: "system", content: system },
        ...input.history.map((item) => ({ role: item.role, content: item.content })),
        { role: "user", content: input.message },
      ],
      response_format: { type: "json_schema", json_schema: OWNER_ASSISTANT_PLAN_JSON_SCHEMA },
      temperature: 0,
      max_tokens: 500,
    });
    return parseOwnerAssistantPlan(output);
  } catch (error) {
    if (error instanceof Error && error.message === "assistant_unavailable") throw error;
    throw new Error("assistant_unavailable");
  }
}
