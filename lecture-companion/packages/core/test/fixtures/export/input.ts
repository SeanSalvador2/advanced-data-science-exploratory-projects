import type {
  LectureManifest,
  LectureNotes,
  Note,
  SpanIndex,
  SpanItem,
  SpanPage,
  TermIndex,
} from "../../../src/index.js";

/**
 * A hand-built three-page lecture for the golden Markdown test.
 *
 * Page 1 has terms but no notes, page 2 has both, page 3 has neither and must
 * be skipped. The items of page 2 are laid out so that a note on lines 1 and 2
 * produces exactly `selection=3,0,5,29`.
 */

function item(id: number, str: string): SpanItem {
  return { id, str, box: [0, id * 12, str.length * 6, 10], transform: [10, 0, 0, 10, 0, 0], font: "f1", eol: false };
}

const PAGE2_ITEMS = [
  item(0, "The "),
  item(1, "certi"),
  item(2, "ficate"),
  item(3, "Noise scale "),
  item(4, "controls the trade-off."),
  item(5, "Radius uses Phi inverse of it"), // 29 characters: the end offset of the link
  item(6, ""),
];

function spanPage(page: number, items: SpanItem[], lines: Array<{ id: number; items: number[]; text: string }>): SpanPage {
  return {
    page,
    width: 720,
    height: 405,
    items,
    lines: lines.map((l) => ({ ...l, box: [0, l.id * 12, 400, 10] })),
  };
}

export const SPANS: SpanIndex = {
  schema: "spans/1",
  pdfjsVersion: "6.3.289",
  extractOptions: { includeMarkedContent: false, disableNormalization: false },
  deckSha256: "0".repeat(64),
  pages: [
    spanPage(1, [item(0, "Certified Defenses")], [{ id: 0, items: [0], text: "Certified Defenses" }]),
    spanPage(2, PAGE2_ITEMS, [
      { id: 0, items: [0, 1, 2], text: "The certificate" },
      { id: 1, items: [3, 4], text: "Noise scale controls the trade-off." },
      { id: 2, items: [5], text: "Radius uses Phi inverse of it" },
    ]),
    spanPage(3, [item(0, "Placeholder")], [{ id: 0, items: [0], text: "Placeholder" }]),
  ],
};

export const MANIFEST: LectureManifest = {
  schema: "lecture/1",
  lectureId: "2026-09-15-lec05",
  course: "TDL",
  number: 5,
  title: "Certified Defenses",
  date: "2026-09-15",
  deck: { file: "deck.pdf", sha256: "0".repeat(64), pages: 3 },
  pdfjs: { includeMarkedContent: false, disableNormalization: false, version: "6.3.289" },
  status: {},
};

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    kind: "generated",
    text: "",
    lineIds: [],
    termIds: [],
    tStart: null,
    tEnd: null,
    tag: "aside",
    confidence: "high",
    ...overrides,
  };
}

export const NOTES: LectureNotes = {
  schema: "notes/1",
  lectureId: "2026-09-15-lec05",
  generated: "2026-09-15T20:14:00.000-04:00",
  pages: [
    { page: 1, title: "Certified Defenses", startS: 0, endS: 120, notes: [] },
    {
      page: 2,
      title: "The certificate",
      startS: 120,
      endS: 4600,
      notes: [
        note({
          id: "n-2-2",
          kind: "student",
          text: "why Phi inverse and not a tail bound?",
          lineIds: [2],
          tStart: 821,
          tEnd: 872,
          tag: "student",
          answer: "Neyman-Pearson makes the worst case a half space, so the distance is exact.",
        }),
        note({
          id: "n-2-1",
          text: "The noise scale is chosen once, at training time, and never touched again at certification time.",
          lineIds: [1, 2],
          termIds: ["t-sigma"],
          tStart: 830,
          tEnd: 862,
          quote: "you pick sigma once and you live with it",
          tag: "why-it-matters",
        }),
        note({
          id: "n-2-3",
          text: "# radii written [[like this]] are the ones the paper reports",
          lineIds: [],
          tStart: 4512,
          tEnd: 4520,
          quote: "the reported radii",
          tag: "caveat",
          confidence: "low",
        }),
      ],
    },
    { page: 3, title: "", startS: null, endS: null, notes: [] },
  ],
  openQuestions: [
    { text: "Why does the certificate degrade with dimension?", page: 2, source: "student", tStart: 1263 },
    { text: "Is sigma public?", page: 3, source: "professor", tStart: null },
  ],
};

export const TERMS: TermIndex = {
  schema: "terms/1",
  lectureId: "2026-09-15-lec05",
  course: "TDL",
  generated: "2026-09-15T09:00:00.000-04:00",
  pages: [
    {
      page: 1,
      title: "Certified Defenses",
      summary: "Title slide.",
      terms: [
        {
          id: "t-certified-defense",
          term: "certified defense",
          aliases: [],
          kind: "concept",
          lineIds: [0],
          definition: "A defense that comes with a proof.",
          intuition: "A guarantee instead of an arms race.",
          inThisCourse: "",
          confidence: "high",
        },
      ],
      passages: [],
      asrBias: [],
    },
    {
      page: 2,
      title: "The certificate",
      summary: "States the certificate.",
      terms: [
        {
          id: "t-sigma",
          term: "sigma",
          aliases: ["σ"],
          kind: "notation",
          lineIds: [1],
          definition: "The standard deviation of the Gaussian noise.",
          intuition: "One knob trading accuracy for radius.",
          inThisCourse: "Fixed at training time.",
          confidence: "high",
        },
      ],
      passages: [],
      asrBias: [],
    },
    { page: 3, title: "", summary: "A placeholder.", terms: [], passages: [], asrBias: [] },
  ],
  glossary: [],
};
