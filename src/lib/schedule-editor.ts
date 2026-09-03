import { addDaysIso } from "@/lib/schedule";
import { paidMinutesFromParts } from "@/lib/payroll";
import { paidHoursError } from "@/lib/shift-entry";

export const SCHEDULE_WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon", name: "weekday-mon" },
  { value: 2, label: "Tue", name: "weekday-tue" },
  { value: 3, label: "Wed", name: "weekday-wed" },
  { value: 4, label: "Thu", name: "weekday-thu" },
  { value: 5, label: "Fri", name: "weekday-fri" },
  { value: 6, label: "Sat", name: "weekday-sat" },
  { value: 7, label: "Sun", name: "weekday-sun" },
] as const;

export type ScheduleEditorMode = "create" | "going_forward";

export type ScheduleEditorDraft = {
  weekdays: number[];
  paidHours: number;
  paidMinutePart: number;
};

export function scheduleChangeMonday(weekStart: string, weekLocked: boolean): string {
  return weekLocked ? addDaysIso(weekStart, 7) : weekStart;
}

export function scheduleEditorMode(hasCurrentSchedule: boolean): ScheduleEditorMode {
  return hasCurrentSchedule ? "going_forward" : "create";
}

export function initialScheduleDraft(schedule: { weekdays: number[]; paidMinutes: number } | null): ScheduleEditorDraft {
  if (!schedule) {
    return { weekdays: [1, 2, 3, 4, 5], paidHours: 1, paidMinutePart: 30 };
  }
  return {
    weekdays: [...schedule.weekdays],
    paidHours: Math.floor(schedule.paidMinutes / 60),
    paidMinutePart: schedule.paidMinutes % 60,
  };
}

export function toggleScheduleWeekday(weekdays: number[], day: number): number[] {
  if (weekdays.includes(day)) return weekdays.filter((value) => value !== day).sort((a, b) => a - b);
  return [...weekdays, day].sort((a, b) => a - b);
}

export function scheduleDraftError(draft: ScheduleEditorDraft): string | null {
  if (draft.weekdays.length === 0) return "Choose at least one weekday.";
  return paidHoursError(draft.paidHours, draft.paidMinutePart);
}

export function schedulePutPayload(input: {
  draft: ScheduleEditorDraft;
  weekStart: string;
  weekLocked: boolean;
  hasCurrentSchedule: boolean;
}) {
  const mode = scheduleEditorMode(input.hasCurrentSchedule);
  const weekStart = mode === "going_forward" ? scheduleChangeMonday(input.weekStart, input.weekLocked) : input.weekStart;
  const body: {
    weekdays: number[];
    paidMinutes: number;
    weekStart: string;
    fromDate?: string;
    mode: ScheduleEditorMode;
  } = {
    weekdays: input.draft.weekdays,
    paidMinutes: paidMinutesFromParts(input.draft.paidHours, input.draft.paidMinutePart),
    weekStart,
    mode,
  };
  if (mode === "create") body.fromDate = input.weekStart;
  return { url: (assignmentId: string) => `/api/assignments/${assignmentId}/schedule`, body };
}

export function scheduleSaveSuccess(mode: ScheduleEditorMode): string {
  return mode === "create" ? "Repeating schedule added." : "Schedule updated going forward.";
}
