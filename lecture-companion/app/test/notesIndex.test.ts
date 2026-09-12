import { describe, expect, it } from "vitest";

import type { LectureNotes, Note, SpanLine } from "@lecture/core";

import {
  anchorSpecs,
  lastPageWithNotes,
  lineAtPoint,
  nextPageWithNotes,
  notesByLine,
  notesOnPage,
  pagesWithNotes,
  prevPageWithNotes,
  referencedLines,
  type AnchorRef,
} from "../src/notes/pageIndex.ts";

function note(over: Partial<Note> & { id: string }): Note {
  return {
    kind: "generated",
    text: "a note",
    lineIds: [],
    termIds: [],
    tStart: 0,
    tEnd: null,
    tag: "intuition",
    confidence: "high",
    ...over,
  };
}

/** The shape of the notes fixture: pages 1-4 and 6 noted, page 5 empty. */
const notes: LectureNotes = {
  schema: "notes/1",
  lectureId: "2026-09-15-lec05",
  generated: "2026-09-15T20:14:00.000-04:00",
  pages: [
    { page: 1, title: "one", startS: 0, endS: 10, notes: [note({ id: "n-1-1" })] },
    {
      page: 2,
      title: "two",
      startS: 10,
      endS: 20,
      notes: [
        note({ id: "n-2-1", lineIds: [0, 1] }),
        note({ id: "n-2-2", lineIds: [4] }),
        note({ id: "n-2-3", kind: "student", tag: "student", lineIds: [1, 2] }),
      ],
    },
    { page: 3, title: "three", startS: 20, endS: 30, notes: [note({ id: "n-3-1" })] },
    { page: 4, title: "four", startS: 30, endS: 40, notes: [note({ id: "n-4-1" })] },
    { page: 5, title: "", startS: null, endS: null, notes: [] },
    { page: 6, title: "six", startS: 40, endS: 50, notes: [note({ id: "n-6-1" })] },
  ],
  openQuestions: [],
};

describe("notes by page", () => {
  it("keeps notes.json's order, which is the order they happened", () => {
    expect(notesOnPage(notes, 2).map((n) => n.id)).toEqual(["n-2-1", "n-2-2", "n-2-3"]);
  });

  it("gives a page with no notes, and an absent index, an empty list", () => {
    expect(notesOnPage(notes, 5)).toEqual([]);
    expect(notesOnPage(notes, 99)).toEqual([]);
    expect(notesOnPage(null, 1)).toEqual([]);
  });

  it("lists only the pages that carry notes", () => {
    expect(pagesWithNotes(notes)).toEqual([1, 2, 3, 4, 6]);
    expect(pagesWithNotes(null)).toEqual([]);
  });

  it("indexes note ids by the slide lines they cite", () => {
    const byLine = notesByLine(notesOnPage(notes, 2));
    expect(byLine.get(0)).toEqual(["n-2-1"]);
    expect(byLine.get(1)).toEqual(["n-2-1", "n-2-3"]);
    expect(byLine.get(4)).toEqual(["n-2-2"]);
    expect(byLine.has(3)).toBe(false);
  });

  it("collects the lines that rest under an underline", () => {
    expect(referencedLines(notesOnPage(notes, 2))).toEqual([0, 1, 2, 4]);
    expect(referencedLines(notesOnPage(notes, 1))).toEqual([]);
  });
});

describe("]/[ navigation", () => {
  const pages = pagesWithNotes(notes);

  it("skips the page with no notes", () => {
    expect(nextPageWithNotes(pages, 4)).toBe(6);
    expect(prevPageWithNotes(pages, 6)).toBe(4);
  });

  it("stops at the ends rather than wrapping", () => {
    expect(nextPageWithNotes(pages, 6)).toBeNull();
    expect(prevPageWithNotes(pages, 1)).toBeNull();
  });

  it("finds the nearest noted page from an unnoted one", () => {
    expect(nextPageWithNotes(pages, 5)).toBe(6);
    expect(prevPageWithNotes(pages, 5)).toBe(4);
  });

  it("knows the last noted page, where the open questions go", () => {
    expect(lastPageWithNotes(pages)).toBe(6);
    expect(lastPageWithNotes([])).toBeNull();
  });
});

describe("anchorSpecs", () => {
  const refs: AnchorRef[] = [
    { id: "n-2-1", lineIds: [0, 1], state: "resting" },
    { id: "n-2-3", lineIds: [1, 2], state: "active", mine: true },
    { id: "n-2-2", lineIds: [4], state: "hover" },
  ];

  it("draws one box per line, never one per reference", () => {
    expect(anchorSpecs(refs).map((s) => s.lineId)).toEqual([0, 1, 2, 4]);
  });

  it("gives a shared line the strongest state and its reference", () => {
    const line1 = anchorSpecs(refs).find((s) => s.lineId === 1);
    expect(line1).toMatchObject({ state: "active", refId: "n-2-3", mine: true });
  });

  it("rounds the first and last line of a reference and nothing between", () => {
    const spans = anchorSpecs([{ id: "r", lineIds: [3, 5, 4], state: "hover" }]);
    expect(spans.map((s) => [s.lineId, s.first, s.last])).toEqual([
      [3, true, false],
      [4, false, false],
      [5, false, true],
    ]);
  });

  it("rounds both corners of a single-line reference", () => {
    expect(anchorSpecs([{ id: "r", lineIds: [7], state: "resting" }])).toEqual([
      { lineId: 7, refId: "r", state: "resting", mine: false, first: true, last: true },
    ]);
  });

  it("has nothing to draw for a note that points at no line", () => {
    expect(anchorSpecs([{ id: "r", lineIds: [], state: "hover" }])).toEqual([]);
  });
});

describe("lineAtPoint", () => {
  const lines: SpanLine[] = [
    { id: 0, items: [], text: "title", box: [65, 52, 397, 30] },
    { id: 1, items: [], text: "bullet", box: [65, 113, 389, 20] },
    { id: 4, items: [], text: "vote", box: [65, 207, 430, 20] },
  ];
  const referenced = new Set([1, 4]);

  it("answers with the line under the point", () => {
    expect(lineAtPoint(lines, referenced, 100, 120)).toBe(1);
    expect(lineAtPoint(lines, referenced, 400, 215)).toBe(4);
  });

  it("ignores lines no note references", () => {
    expect(lineAtPoint(lines, referenced, 100, 60)).toBeNull();
  });

  it("answers with nothing off the boxes", () => {
    expect(lineAtPoint(lines, referenced, 900, 120)).toBeNull();
    expect(lineAtPoint(lines, referenced, 100, 400)).toBeNull();
  });
});
