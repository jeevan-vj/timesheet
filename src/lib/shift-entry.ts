import { calculateEntryPayCents, calculatePaidMinutes, MAX_SAME_DAY_MINUTES, paidMinutesFromParts } from "@/lib/payroll";

export const ASSIGN_ANOTHER_SITE = "__assign__";

export type EntryMode = "paid_hours" | "clock";

export type ShiftEntryDraft = {
  contractorId: string;
  siteId: string;
  workDate: string;
  notes: string;
  mode: EntryMode;
  paidHours: number;
  paidMinutePart: number;
  start: string;
  end: string;
  breakMinutes: number;
  assigningSite: boolean;
  newSiteId: string;
  newSiteRate: string;
};

type SiteOption = { id: string; name: string };
type AssignmentOption = { contractorId: string; siteId: string; rateCents: number | null };

export function initialShiftDraft(input: { weekStart: string; contractorId: string; siteId: string }): ShiftEntryDraft {
  return {
    contractorId: input.contractorId,
    siteId: input.siteId,
    workDate: input.weekStart,
    notes: "",
    mode: "paid_hours",
    paidHours: 8,
    paidMinutePart: 0,
    start: "08:00",
    end: "16:30",
    breakMinutes: 30,
    assigningSite: !input.siteId,
    newSiteId: "",
    newSiteRate: "",
  };
}

export function switchEntryMode(draft: ShiftEntryDraft, mode: EntryMode): ShiftEntryDraft {
  return { ...draft, mode };
}

export function selectContractor(draft: ShiftEntryDraft, contractorId: string, assignedSiteIds: string[]): ShiftEntryDraft {
  const siteStillAssigned = assignedSiteIds.includes(draft.siteId);
  const hasAssignedSites = assignedSiteIds.length > 0;
  return {
    ...draft,
    contractorId,
    siteId: siteStillAssigned ? draft.siteId : "",
    assigningSite: siteStillAssigned ? false : !hasAssignedSites,
    newSiteId: "",
    newSiteRate: "",
  };
}

export function sitesForContractor(sites: SiteOption[], assignments: AssignmentOption[], contractorId: string) {
  const assignedIds = new Set(assignments.filter((row) => row.contractorId === contractorId).map((row) => row.siteId));
  return {
    assigned: sites.filter((site) => assignedIds.has(site.id)),
    unassigned: sites.filter((site) => !assignedIds.has(site.id)),
  };
}

export function effectiveRateCents(input: { defaultRateCents: number; assignmentRateCents: number | null; overrideRateCents: number | null }): number {
  return input.overrideRateCents ?? input.assignmentRateCents ?? input.defaultRateCents;
}

export function formatNzd(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  const amount = remainder === 0 ? `${dollars}` : `${dollars}.${String(remainder).padStart(2, "0")}`;
  return `${negative ? "-" : ""}NZ$${amount}`;
}

export function formatPaidDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function formatPayPreview(paidMinutes: number, rateCents: number): string {
  return `${formatPaidDuration(paidMinutes)} × ${formatNzd(rateCents)}/hr = ${formatNzd(calculateEntryPayCents(paidMinutes, rateCents))}`;
}

export function clockShiftError(startMinutes: number, endMinutes: number, breakMinutes: number): string | null {
  if (endMinutes <= startMinutes) return "Finish must be later than start on the same day.";
  try {
    calculatePaidMinutes(startMinutes, endMinutes, breakMinutes);
    return null;
  } catch {
    return "Unpaid break must leave a positive paid duration.";
  }
}

export function paidHoursError(hours: number, minutePart: number): string | null {
  if (!Number.isInteger(hours) || !Number.isInteger(minutePart)) return "Enter whole hours and minutes.";
  if (minutePart < 0 || minutePart > 59) return "Minutes must be between 0 and 59.";
  if (hours < 0 || hours * 60 + minutePart <= 0) return "Paid hours must be greater than zero.";
  if (hours * 60 + minutePart > MAX_SAME_DAY_MINUTES) return "Paid hours must be less than 24 hours on the same day.";
  return null;
}

export function parseRateDollars(value: string): number | null | "invalid" {
  if (value.trim() === "") return null;
  const dollars = Number(value);
  if (!Number.isFinite(dollars)) return "invalid";
  const cents = Math.round(dollars * 100);
  if (cents < 1_500 || cents > 25_000) return "invalid";
  return cents;
}

export function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function shiftEntryPayload(draft: ShiftEntryDraft) {
  const assigning = draft.assigningSite || draft.siteId === ASSIGN_ANOTHER_SITE;
  const siteId = assigning ? draft.newSiteId : draft.siteId;
  const notes = draft.notes.trim();
  const parsedRate = parseRateDollars(draft.newSiteRate);
  const assignSite = assigning ? { assignSite: { rateCents: parsedRate === "invalid" ? null : parsedRate } } : {};
  if (draft.mode === "paid_hours") {
    return {
      entryMode: "paid_hours" as const,
      contractorId: draft.contractorId,
      siteId,
      workDate: draft.workDate,
      paidMinutes: paidMinutesFromParts(draft.paidHours, draft.paidMinutePart),
      notes,
      ...assignSite,
    };
  }
  return {
    entryMode: "clock" as const,
    contractorId: draft.contractorId,
    siteId,
    workDate: draft.workDate,
    startMinutes: toMinutes(draft.start),
    endMinutes: toMinutes(draft.end),
    breakMinutes: draft.breakMinutes,
    notes,
    ...assignSite,
  };
}

export function shiftSaveErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "duplicate_entry") return "A shift for this contractor, site, and date is already recorded. Change the date or site, or delete the existing shift first.";
  if (code === "invalid_shift") return "Finish time and break must leave a positive paid shift.";
  if (code === "not_found") return "That site is not assigned to this contractor. Assign the site from this form and try again.";
  return "Could not save this shift. Check your connection and try again.";
}

export function shiftEntryBlocker(data: { contractors: unknown[]; sites: unknown[] }) {
  if (!data.contractors.length) {
    return { href: "#team", label: "Add a contractor", message: "Add a contractor before recording a shift." };
  }
  if (!data.sites.length) {
    return { href: "#team", label: "Add a site", message: "Add a site before recording a shift." };
  }
  return null;
}

export function createShiftSaveGuard() {
  let busy = false;
  return {
    get busy() {
      return busy;
    },
    async run(task: () => Promise<void>) {
      if (busy) return;
      busy = true;
      try {
        await task();
      } finally {
        busy = false;
      }
    },
  };
}

export function draftDurationError(draft: ShiftEntryDraft): string | null {
  if (draft.mode === "paid_hours") return paidHoursError(draft.paidHours, draft.paidMinutePart);
  return clockShiftError(toMinutes(draft.start), toMinutes(draft.end), draft.breakMinutes);
}

export function draftSaveError(draft: ShiftEntryDraft): string | null {
  if (!draft.contractorId) return "Choose a contractor.";
  const assigning = draft.assigningSite || draft.siteId === ASSIGN_ANOTHER_SITE;
  if (assigning) {
    if (!draft.newSiteId) return "Choose a site to assign.";
    if (parseRateDollars(draft.newSiteRate) === "invalid") return "Rate for this site must be between NZ$15 and NZ$250.";
  } else if (!draft.siteId) {
    return "Choose a site.";
  }
  if (!draft.workDate) return "Choose a date.";
  return draftDurationError(draft);
}

export function selectSite(draft: ShiftEntryDraft, siteId: string): ShiftEntryDraft {
  if (siteId === ASSIGN_ANOTHER_SITE) return { ...draft, siteId, assigningSite: true };
  return { ...draft, siteId, assigningSite: false, newSiteId: "", newSiteRate: "" };
}

export function draftPaidMinutes(draft: ShiftEntryDraft): number | null {
  try {
    if (draft.mode === "paid_hours") return paidMinutesFromParts(draft.paidHours, draft.paidMinutePart);
    return calculatePaidMinutes(toMinutes(draft.start), toMinutes(draft.end), draft.breakMinutes);
  } catch {
    return null;
  }
}
