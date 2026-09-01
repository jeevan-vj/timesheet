import { visibleShiftNote } from "@/lib/shift-note";

export function ShiftTableNote({ notes, noteId }: { notes: string; noteId: string }) {
  const note = visibleShiftNote(notes);
  if (!note) return null;
  return <p className="shift-note" id={noteId}><span className="shift-note-label">Notes</span> {note}</p>;
}
