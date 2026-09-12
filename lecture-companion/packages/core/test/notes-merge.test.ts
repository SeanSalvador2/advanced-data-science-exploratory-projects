import { describe, expect, it } from "vitest";
import { canonicalLectureNotes, mergeNotePages, orderNotes } from "../src/index.js";
import type { LectureNotes, Note, NotePage, NotesPartial, OpenQuestion } from "../src/index.js";

const GENERATED = "2026-09-15T20:14:00.000+00:00";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "",
    kind: "generated",
    text: "something the professor said",
    lineIds: [],
    termIds: [],
    tStart: null,
    tEnd: null,
    tag: "aside",
    confidence: "high",
    ...overrides,
  };
}

function page(n: number, notes: Note[], overrides: Partial<NotePage> = {}): NotePage {
  return { page: n, title: `Slide ${n}`, startS: null, endS: null, notes, ...overrides };
}

function partial(source: string, pages: NotePage[], openQuestions: OpenQuestion[] = []): NotesPartial {
  return { source, pages, openQuestions };
}

function merge(partials: NotesPartial[], deckPages: number, opts: Record<string, unknown> = {}) {
  return mergeNotePages(partials, deckPages, { lectureId: "lec05", generated: GENERATED, ...opts });
}

describe("orderNotes", () => {
  it("interleaves student and generated notes by time, untimed last", () => {
    const ordered = orderNotes([
      note({ text: "general", kind: "generated" }),
      note({ text: "answer", kind: "generated", tStart: 400 }),
      note({ text: "question", kind: "student", tag: "student", tStart: 380 }),
      note({ text: "also general", kind: "generated" }),
    ]);
    expect(ordered.map((n) => n.text)).toEqual(["question", "answer", "general", "also general"]);
  });
});

describe("mergeNotePages", () => {
  it("assigns n-<page>-<k> in reading order", () => {
    const result = merge(
      [
        partial("batch-01.json", [
          page(1, [note({ tStart: 30 }), note({ tStart: 10 }), note()]),
          page(2, [note({ tStart: 200, kind: "student", tag: "student" })]),
        ]),
      ],
      2,
    );
    expect(result.issues).toEqual([]);
    expect(result.notes.pages[0]?.notes.map((n) => [n.id, n.tStart])).toEqual([
      ["n-1-1", 10],
      ["n-1-2", 30],
      ["n-1-3", null],
    ]);
    expect(result.notes.pages[1]?.notes[0]?.id).toBe("n-2-1");
  });

  it("reports a page delivered by two partials", () => {
    const result = merge(
      [partial("batch-01.json", [page(2, [])]), partial("batch-02.json", [page(2, [])])],
      6,
    );
    expect(result.issues).toContainEqual({
      kind: "duplicate",
      page: 2,
      sources: ["batch-01.json", "batch-02.json"],
    });
  });

  it("reports a page outside the deck and a page that is not a page number", () => {
    const result = merge(
      [partial("batch-02.json", [page(9, []), { ...page(1, []), page: 2.5 }])],
      6,
    );
    expect(result.issues).toContainEqual({ kind: "out-of-range", page: 9, sources: ["batch-02.json"] });
    expect(result.issues).toContainEqual({ kind: "invalid", page: 2.5, sources: ["batch-02.json"] });
  });

  it("fails on a page that was shown and talked over but never noted", () => {
    const spans = new Map([[3, { startS: 330, endS: 540 }]]);
    const result = merge([partial("batch-01.json", [page(1, [])])], 3, { spans });
    expect(result.missingShown).toEqual([3]);
    expect(result.issues).toContainEqual({ kind: "missing-shown", pages: [3] });
  });

  it("accepts a page that was never shown, and gives it null times", () => {
    const result = merge([partial("batch-01.json", [page(1, [])])], 3, {
      titles: new Map([[3, "Placeholder"]]),
    });
    expect(result.issues).toEqual([]);
    expect(result.uncovered).toEqual([2, 3]);
    expect(result.missingShown).toEqual([]);
    expect(result.notes.pages[2]).toEqual({
      page: 3,
      title: "Placeholder",
      startS: null,
      endS: null,
      notes: [],
    });
  });

  it("fills an uncovered but shown page from the transcript span under --allow-missing", () => {
    const spans = new Map([[2, { startS: 130, endS: 330 }]]);
    const result = merge([partial("batch-01.json", [page(1, [])])], 2, {
      spans,
      allowMissing: true,
    });
    expect(result.issues).toEqual([]);
    expect(result.notes.pages[1]).toMatchObject({ page: 2, startS: 130, endS: 330, notes: [] });
  });

  it("concatenates open questions and drops repeats by normalised text", () => {
    const q = (text: string, page: number): OpenQuestion => ({ text, page, source: "student", tStart: null });
    const result = merge(
      [
        partial("batch-01.json", [page(1, [])], [q("Why does it degrade with dimension?", 1)]),
        partial(
          "batch-02.json",
          [page(2, [])],
          [q("why does it degrade with dimension?  ", 1), q("Is sigma public?", 2)],
        ),
      ],
      2,
    );
    expect(result.notes.openQuestions.map((x) => x.text)).toEqual([
      "Why does it degrade with dimension?",
      "Is sigma public?",
    ]);
    expect(result.duplicateQuestions).toBe(1);
  });

  it("writes the same bytes for the same partials, whatever order the keys arrived in", () => {
    const build = (): NotesPartial[] => [
      partial(
        "batch-01.json",
        [page(1, [note({ tStart: 10, quote: "said so", termIds: ["t-a"], lineIds: [2] })])],
        [{ text: "open", page: 1, source: "professor", tStart: 5 }],
      ),
    ];
    const a = JSON.stringify(merge(build(), 1).notes);
    const b = JSON.stringify(merge(build(), 1).notes);
    expect(a).toBe(b);

    // Key order is fixed by canonicalLectureNotes, not by how the object was built.
    const shuffled = {
      openQuestions: [],
      pages: [{ notes: [], title: "t", page: 1, endS: null, startS: null }],
      generated: GENERATED,
      lectureId: "lec05",
      schema: "notes/1",
    } as unknown as LectureNotes;
    expect(Object.keys(canonicalLectureNotes(shuffled))).toEqual([
      "schema",
      "lectureId",
      "generated",
      "pages",
      "openQuestions",
    ]);
    expect(Object.keys(canonicalLectureNotes(shuffled).pages[0] as NotePage)).toEqual([
      "page",
      "title",
      "startS",
      "endS",
      "notes",
    ]);
  });
});
