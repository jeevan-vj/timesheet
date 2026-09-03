import { calculatePaidMinutes } from "@/lib/payroll";

export function paidHoursClockFields(paidMinutes: number) {
  return { startMinutes: 0, endMinutes: paidMinutes, breakMinutes: 0 };
}

export type TimeEntryClockWrite =
  | { entryMode: "clock"; startMinutes: number; endMinutes: number; breakMinutes: number }
  | { entryMode: "paid_hours"; paidMinutes: number }
  | { entryMode: "absent" };

export function clockFieldsForWrite(input: TimeEntryClockWrite) {
  if (input.entryMode === "absent") {
    return {
      entryMode: "absent" as const,
      paidMinutes: 0,
      startMinutes: 0,
      endMinutes: 0,
      breakMinutes: 0,
    };
  }
  if (input.entryMode === "paid_hours") {
    return {
      entryMode: "paid_hours" as const,
      paidMinutes: input.paidMinutes,
      ...paidHoursClockFields(input.paidMinutes),
    };
  }
  return {
    entryMode: "clock" as const,
    paidMinutes: calculatePaidMinutes(input.startMinutes, input.endMinutes, input.breakMinutes),
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    breakMinutes: input.breakMinutes,
  };
}

export function shouldResnapshotRate(
  existing: { contractorId: string; siteId: string },
  next: { contractorId: string; siteId: string },
) {
  return existing.contractorId !== next.contractorId || existing.siteId !== next.siteId;
}

export function rateCentsForUpdate(input: {
  existingRateCents: number;
  resnapshot: boolean;
  assignmentEffectiveRate: number | null | undefined;
}) {
  if (!input.resnapshot) return input.existingRateCents;
  if (input.assignmentEffectiveRate == null) throw new Error("not_found");
  return input.assignmentEffectiveRate;
}

export function hasDuplicateTimeEntry(existingId: string, collidingId: string | null | undefined) {
  return collidingId != null && collidingId !== existingId;
}
