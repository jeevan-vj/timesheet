import { describe, expect, it } from "vitest";
import {
  WEEKLY_SHIFT_NOTE_LABEL,
  weeklyShiftNoteElementId,
  weeklyShiftNoteText,
} from "../src/lib/weekly-shift-note";

describe("weekly shift note display", () => {
  it("returns trimmed text and a visible Note label for non-empty notes", () => {
    expect(weeklyShiftNoteText("  Keys returned  ")).toBe("Keys returned");
    expect(WEEKLY_SHIFT_NOTE_LABEL).toBe("Note");
  });

  it("does not render empty, whitespace-only, or empty-after-trim notes", () => {
    expect(weeklyShiftNoteText("")).toBeNull();
    expect(weeklyShiftNoteText("   ")).toBeNull();
    expect(weeklyShiftNoteText("\n\t")).toBeNull();
  });

  it("preserves inner whitespace after trimming surrounding space", () => {
    expect(weeklyShiftNoteText("  Keys  returned  ")).toBe("Keys  returned");
  });

  it("builds a unique note element id from the entry id", () => {
    expect(weeklyShiftNoteElementId("entry-1")).toBe("shift-note-entry-1");
  });
});
