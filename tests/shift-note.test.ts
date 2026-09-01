import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { visibleShiftNote } from "../src/lib/shift-note";

describe("visibleShiftNote", () => {
  it("returns a non-empty note unchanged", () => {
    expect(visibleShiftNote("Keys returned")).toBe("Keys returned");
  });

  it("trims surrounding whitespace from a saved note", () => {
    expect(visibleShiftNote("  Keys returned  ")).toBe("Keys returned");
  });

  it("hides an empty note", () => {
    expect(visibleShiftNote("")).toBeNull();
  });

  it("hides whitespace-only notes", () => {
    expect(visibleShiftNote("   ")).toBeNull();
    expect(visibleShiftNote("\n\t")).toBeNull();
  });

  it("keeps inner line breaks after trim", () => {
    expect(visibleShiftNote("  Line 1\nLine 2  ")).toBe("Line 1\nLine 2");
  });
});

describe("weekly table note presentation", () => {
  it("renders a labeled note in the shift row and skips empty notes", () => {
    const helper = fs.readFileSync(path.resolve("src/lib/shift-note.ts"), "utf8");
    const component = fs.readFileSync(path.resolve("src/components/shift-note.tsx"), "utf8");
    const dashboard = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");

    expect(helper).toContain("notes.trim()");
    expect(component).toContain("visibleShiftNote(notes)");
    expect(component).toContain("if (!note) return null");
    expect(component).toContain("shift-note-label");
    expect(component).toContain(">Notes</span>");
    expect(dashboard).toContain("visibleShiftNote(entry.notes)");
    expect(dashboard).toContain("<ShiftTableNote notes={entry.notes} noteId={noteId} />");
    expect(dashboard).toContain("aria-describedby={note ? noteId : undefined}");

    const summary = dashboard.slice(dashboard.indexOf("summary-panel"), dashboard.indexOf("SetupPanel"));
    expect(summary).not.toContain("ShiftTableNote");
    expect(summary).not.toContain("shift-note");
  });

  it("styles notes with wrapping and a non-colour-only label", () => {
    const css = fs.readFileSync(path.resolve("src/app/styles.css"), "utf8");
    expect(css).toContain("white-space:pre-wrap");
    expect(css).toContain("overflow-wrap:anywhere");
    expect(css).toMatch(/\.shift-note-label\s*\{[^}]*font-weight:800/);
  });
});
