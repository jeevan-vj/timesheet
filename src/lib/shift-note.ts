export function visibleShiftNote(notes: string): string | null {
  const text = notes.trim();
  return text.length > 0 ? text : null;
}
