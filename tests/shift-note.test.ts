import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShiftTableNote } from "../src/components/shift-note";
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

describe("ShiftTableNote", () => {
  it("renders the Notes label and text for a saved note", () => {
    const html = renderToStaticMarkup(createElement(ShiftTableNote, { notes: "Keys returned", noteId: "shift-note-1" }));
    expect(html).toContain("shift-note-1");
    expect(html).toContain("Notes");
    expect(html).toContain("Keys returned");
    expect(html).toContain("shift-note-label");
  });

  it("preserves inner line breaks in the note text", () => {
    const html = renderToStaticMarkup(createElement(ShiftTableNote, { notes: "Line 1\nLine 2", noteId: "shift-note-2" }));
    expect(html).toContain("Line 1\nLine 2");
  });

  it("renders nothing for empty or whitespace-only notes", () => {
    expect(renderToStaticMarkup(createElement(ShiftTableNote, { notes: "", noteId: "empty" }))).toBe("");
    expect(renderToStaticMarkup(createElement(ShiftTableNote, { notes: "   ", noteId: "spaces" }))).toBe("");
    expect(renderToStaticMarkup(createElement(ShiftTableNote, { notes: "\n\t", noteId: "ws" }))).toBe("");
  });
});

describe("weekly table note presentation", () => {
  it("associates a visible note with the same shift row", () => {
    const source = fs.readFileSync(path.resolve("src/components/dashboard.tsx"), "utf8");
    expect(source).toContain("visibleShiftNote(entry.notes)");
    expect(source).toContain("<ShiftTableNote notes={entry.notes} noteId={noteId} />");
    expect(source).toContain("aria-describedby={note ? noteId : undefined}");
    const summary = source.slice(source.indexOf("summary-panel"), source.indexOf("SetupPanel"));
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
