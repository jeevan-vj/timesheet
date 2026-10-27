export type PayrollEntry = {
  contractorId: string;
  contractorName: string;
  paidMinutes: number;
  rateCents: number;
};

export type ContractorWeek = {
  contractorId: string;
  contractorName: string;
  paidMinutes: number;
  payCents: number;
};

export const MAX_SAME_DAY_MINUTES = 1_439;

export function calculatePaidMinutes(startMinutes: number, endMinutes: number, breakMinutes: number): number {
  const paid = endMinutes - startMinutes - breakMinutes;
  if (!Number.isInteger(startMinutes) || !Number.isInteger(endMinutes) || !Number.isInteger(breakMinutes) || paid <= 0) {
    throw new Error("invalid_shift");
  }
  return paid;
}

export function paidMinutesFromParts(hours: number, minutePart: number): number {
  if (!Number.isInteger(hours) || !Number.isInteger(minutePart) || hours < 0 || minutePart < 0 || minutePart > 59) {
    throw new Error("invalid_shift");
  }
  const paid = hours * 60 + minutePart;
  if (paid <= 0 || paid > MAX_SAME_DAY_MINUTES) throw new Error("invalid_shift");
  return paid;
}

export function calculateEntryPayCents(paidMinutes: number, rateCents: number): number {
  if (!Number.isInteger(paidMinutes) || !Number.isInteger(rateCents) || paidMinutes <= 0 || rateCents <= 0) {
    throw new Error("invalid_pay_input");
  }
  return Math.round((paidMinutes * rateCents) / 60);
}

export function summarizeWeek(entries: PayrollEntry[]): ContractorWeek[] {
  const totals = new Map<string, ContractorWeek>();
  for (const entry of entries) {
    const current = totals.get(entry.contractorId) ?? {
      contractorId: entry.contractorId,
      contractorName: entry.contractorName,
      paidMinutes: 0,
      payCents: 0,
    };
    current.paidMinutes += entry.paidMinutes;
    if (entry.paidMinutes > 0) {
      current.payCents += calculateEntryPayCents(entry.paidMinutes, entry.rateCents);
    }
    totals.set(entry.contractorId, current);
  }
  return [...totals.values()].sort((a, b) => a.contractorName.localeCompare(b.contractorName));
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function isMonday(value: string): boolean {
  return isIsoDate(value) && new Date(`${value}T00:00:00.000Z`).getUTCDay() === 1;
}

export function weekEnd(weekStart: string): string {
  if (!isMonday(weekStart)) throw new Error("invalid_week_start");
  const end = new Date(`${weekStart}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  return end.toISOString().slice(0, 10);
}

export function weekStartFromDate(isoDate: string): string {
  if (!isIsoDate(isoDate)) throw new Error("invalid_week_start");
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const weekday = date.getUTCDay();
  const daysFromMonday = weekday === 0 ? 6 : weekday - 1;
  date.setUTCDate(date.getUTCDate() - daysFromMonday);
  return date.toISOString().slice(0, 10);
}

export function weekPayrollTotals(entries: ReadonlyArray<{ paidMinutes: number; rateCents: number }>): {
  currentPaidMinutes: number;
  currentPayCents: number;
} {
  let currentPaidMinutes = 0;
  let currentPayCents = 0;
  for (const entry of entries) {
    currentPaidMinutes += entry.paidMinutes;
    if (entry.paidMinutes > 0) {
      currentPayCents += calculateEntryPayCents(entry.paidMinutes, entry.rateCents);
    }
  }
  return { currentPaidMinutes, currentPayCents };
}
