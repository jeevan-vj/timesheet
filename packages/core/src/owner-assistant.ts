import { z } from "zod";
import { ownerRemittanceSchema } from "./owner-read";
import { weekStartInput } from "./validation";

const message = z.string().trim().min(1).max(500);
const reply = z.string().trim().min(1).max(800);
const rateCents = z.number().int().min(1_500).max(25_000);
const resourceName = z.string().trim().min(1).max(100);

export const ownerAssistantOperationSchema = z.enum([
  "create_contractor",
  "create_site",
  "assign_site",
  "get_remittance",
]);

export const ownerAssistantHistoryMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: message,
}).strict();

export const ownerAssistantTurnInputSchema = z.object({
  message,
  history: z.array(ownerAssistantHistoryMessageSchema).max(8).default([]),
  form: z.lazy(() => ownerAssistantFormSubmissionSchema).optional(),
}).strict();

export const ownerAssistantPlanSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("clarify"),
    reply,
    operation: ownerAssistantOperationSchema.nullable().default(null),
    weekStart: weekStartInput.optional(),
  }).strict(),
  z.object({
    intent: z.literal("create_contractor"), reply,
    operation: z.null().default(null),
    name: resourceName,
    email: z.union([z.literal(""), z.email().max(254)]).default(""),
    phone: z.string().trim().max(40).default(""),
    defaultRateCents: rateCents,
  }).strict(),
  z.object({
    intent: z.literal("create_site"), reply,
    operation: z.null().default(null),
    name: resourceName,
    address: z.string().trim().max(240).default(""),
  }).strict(),
  z.object({
    intent: z.literal("assign_site"), reply,
    operation: z.null().default(null),
    contractorName: resourceName,
    siteName: resourceName,
    rateCents: rateCents.nullable().default(null),
  }).strict(),
  z.object({
    intent: z.literal("get_remittance"), reply,
    operation: z.null().default(null),
    contractorName: resourceName,
    weekStart: weekStartInput,
  }).strict(),
]);

export const OWNER_ASSISTANT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: ["clarify", "create_contractor", "create_site", "assign_site", "get_remittance"] },
    reply: { type: "string" },
    operation: { type: ["string", "null"], enum: ["create_contractor", "create_site", "assign_site", "get_remittance", null] },
    name: { type: "string" }, email: { type: "string" }, phone: { type: "string" },
    defaultRateCents: { type: "integer" }, address: { type: "string" },
    contractorName: { type: "string" }, siteName: { type: "string" },
    rateCents: { type: ["integer", "null"] }, weekStart: { type: "string" },
  },
  required: ["intent", "reply", "operation"],
} as const;

export const ownerAssistantFormSubmissionSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create_contractor"),
    name: resourceName,
    email: z.union([z.literal(""), z.email().max(254)]),
    phone: z.string().trim().max(40),
    defaultRateCents: rateCents,
  }).strict(),
  z.object({
    operation: z.literal("create_site"),
    name: resourceName,
    address: z.string().trim().max(240),
  }).strict(),
  z.object({
    operation: z.literal("assign_site"),
    contractorName: resourceName,
    siteName: resourceName,
    rateCents: rateCents.nullable(),
  }).strict(),
  z.object({
    operation: z.literal("get_remittance"),
    contractorName: resourceName,
    weekStart: weekStartInput,
  }).strict(),
]);

const ownerAssistantOptionSchema = z.object({
  label: resourceName,
  value: resourceName,
}).strict();

const ownerAssistantGuidedInputSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create_contractor") }).strict(),
  z.object({ operation: z.literal("create_site") }).strict(),
  z.object({
    operation: z.literal("assign_site"),
    contractors: z.array(ownerAssistantOptionSchema).min(1).max(200),
    sites: z.array(ownerAssistantOptionSchema).min(1).max(200),
  }).strict(),
  z.object({
    operation: z.literal("get_remittance"),
    contractors: z.array(ownerAssistantOptionSchema).min(1).max(200),
    weekStart: weekStartInput,
  }).strict(),
]);

const detailSchema = z.object({ label: z.string().min(1), value: z.string().min(1) }).strict();
const confirmationSchema = z.object({
  action: z.enum(["create_contractor", "create_site", "assign_site"]),
  token: z.string().min(1).max(4_000),
  expiresAt: z.string().datetime(),
  title: z.string().min(1),
  details: z.array(detailSchema).min(1).max(6),
}).strict();

export const ownerAssistantTurnResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), message: reply }).strict(),
  z.object({ kind: z.literal("input"), message: reply, input: ownerAssistantGuidedInputSchema }).strict(),
  z.object({ kind: z.literal("preview"), message: reply, confirmation: confirmationSchema }).strict(),
  z.object({
    kind: z.literal("remittance"), message: reply,
    verification: z.object({
      status: z.enum(["verified", "provisional", "incomplete"]),
      detail: z.string().min(1),
    }).strict(),
    remittance: ownerRemittanceSchema,
  }).strict(),
]);

export const ownerAssistantConfirmInputSchema = z.object({ token: z.string().min(1).max(4_000) }).strict();
export const ownerAssistantConfirmResponseSchema = z.object({
  kind: z.literal("receipt"), message: reply,
  action: z.enum(["create_contractor", "create_site", "assign_site"]),
  targetId: z.string().min(1),
}).strict();

export type OwnerAssistantHistoryMessage = z.infer<typeof ownerAssistantHistoryMessageSchema>;
export type OwnerAssistantTurnInput = z.infer<typeof ownerAssistantTurnInputSchema>;
export type OwnerAssistantPlan = z.infer<typeof ownerAssistantPlanSchema>;
export type OwnerAssistantFormSubmission = z.infer<typeof ownerAssistantFormSubmissionSchema>;
export type OwnerAssistantGuidedInput = z.infer<typeof ownerAssistantGuidedInputSchema>;
export type OwnerAssistantTurnResponse = z.infer<typeof ownerAssistantTurnResponseSchema>;
export type OwnerAssistantConfirmResponse = z.infer<typeof ownerAssistantConfirmResponseSchema>;
