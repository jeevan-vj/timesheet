export const WEEKLY_SHIFT_NOTE_LABEL = "Note";

export function weeklyShiftNoteText(notes: string): string | null {
  const trimmed = notes.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function weeklyShiftNoteElementId(entryId: string): string {
  return `shift-note-${entryId}`;
}
