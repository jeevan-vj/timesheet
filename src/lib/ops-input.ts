import { z } from "zod";
import { contractorInput, timeEntryInput, timeEntryUpdateInput, weekStartInput } from "@/lib/validation";

const ownerUserId = z.string().trim().min(1).max(64);
const reason = z.string().trim().min(1).max(500);
const sqlParam = z.union([
  z.string().max(2_000),
  z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.null(),
]);

export const opsCreateContractorInput = contractorInput.extend({
  ownerUserId,
  reason,
});

export const opsUpdateContractorInput = z.object({
  ownerUserId,
  reason,
  name: contractorInput.shape.name,
  email: contractorInput.shape.email,
  phone: contractorInput.shape.phone,
});

export const opsContractorRateInput = z.object({
  ownerUserId,
  reason,
  defaultRateCents: contractorInput.shape.defaultRateCents,
});

export const opsOwnerReasonInput = z.object({
  ownerUserId,
  reason,
});

const opsTimeEntryMeta = z.object({
  ownerUserId,
  reason,
  confirmLockedWeek: z.boolean().optional(),
});

export function parseOpsTimeEntryCreate(body: unknown) {
  const meta = opsTimeEntryMeta.safeParse(body);
  const entry = timeEntryInput.safeParse(body);
  if (!meta.success || !entry.success) return null;
  return { ...entry.data, ...meta.data };
}

export function parseOpsTimeEntryUpdate(body: unknown) {
  const meta = opsTimeEntryMeta.safeParse(body);
  const entry = timeEntryUpdateInput.safeParse(body);
  if (!meta.success || !entry.success) return null;
  return { ...entry.data, ...meta.data };
}

export const opsSqlPreviewInput = z.object({
  sql: z.string().trim().min(1).max(8_000),
  params: z.array(sqlParam).max(64).default([]),
});

export const opsSqlExecuteInput = opsSqlPreviewInput.extend({
  reason,
  confirmToken: z.string().trim().min(1).max(4_000),
});

export const opsRevertInput = z.object({
  ownerUserId,
  auditId: z.string().trim().min(1).max(64),
  reason,
  confirmLockedWeek: z.boolean().optional(),
});

export const opsWagesQueryInput = z.object({
  ownerUserId,
  week: weekStartInput,
  contractorId: z.string().trim().min(1).max(64).optional(),
  siteId: z.string().trim().min(1).max(64).optional(),
});
