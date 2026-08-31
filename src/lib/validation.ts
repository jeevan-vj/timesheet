import { z } from "zod";
import { isIsoDate, isMonday } from "@/lib/payroll";

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalTrimmed = (max: number) => z.string().trim().max(max).default("");
const rateCents = z.number().int().min(1_500).max(25_000);

export const siteInput = z.object({
  name: trimmed(100),
  address: optionalTrimmed(240),
});

export const contractorInput = z.object({
  name: trimmed(100),
  email: z.union([z.literal(""), z.email().max(254)]).default(""),
  phone: optionalTrimmed(40),
  defaultRateCents: rateCents,
});

export const assignmentInput = z.object({
  contractorId: trimmed(64),
  siteId: trimmed(64),
  rateCents: rateCents.nullable().default(null),
});

const timeEntryBase = {
  contractorId: trimmed(64),
  siteId: trimmed(64),
  workDate: z.string().refine(isIsoDate, "Invalid work date"),
  notes: optionalTrimmed(500),
  assignSite: z.object({
    rateCents: rateCents.nullable().default(null),
  }).optional(),
};

export const timeEntryInput = z.discriminatedUnion("entryMode", [
  z.object({
    entryMode: z.literal("clock"),
    startMinutes: z.number().int().min(0).max(1438),
    endMinutes: z.number().int().min(1).max(1439),
    breakMinutes: z.number().int().min(0).max(720),
    ...timeEntryBase,
  }),
  z.object({
    entryMode: z.literal("paid_hours"),
    paidMinutes: z.number().int().min(1).max(1439),
    ...timeEntryBase,
  }),
]);

export const weekStartInput = z.string().refine(isMonday, "Week must start on Monday");
