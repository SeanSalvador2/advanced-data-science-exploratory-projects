import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  lookup,
  lookupTerm,
  normalizeForMatch,
  termsOnPageInLineOrder,
  TermIndexSchema,
  SpanIndexSchema,
  type LookupSelection,
  type Passage,
  type SpanPage,
  type Term,
  type TermIndex,
  type TermPage,
} from "../src/index.js";

/* ------------------------------------------------------------------ */
/* A hand-built page: four lines, one item each, so a span id is a line. */

function spanPage(lineCount: number): SpanPage {
  return {
    page: 1,
    width: 960,
    height: 540,
    items: Array.from({ length: lineCount }, (_, i) => ({
      id: i,
      str: `line ${i}`,
      box: [0, i * 20, 100, 18] as [number, number, number, number],
      transform: [18, 0, 0, 18, 0, i * 20 + 18] as [
        number,
        number,
        number,
        number,
        number,
        number,
      ],
      font: "f1",
      eol: true,
    })),
    lines: Array.from({ length: lineCount }, (_, i) => ({
      id: i,
      items: [i],
      text: `line ${i}`,
      box: [0, i * 20, 100, 18] as [number, number, number, number],
    })),
  };
}

function term(id: string, name: string, lineIds: number[], aliases: string[] = []): Term {
  return {
    id: `t-${id}`,
    term: name,
    aliases,
    kind: "concept",
    lineIds,
    definition: `${name} definition`,
    intuition: `${name} intuition`,
    inThisCourse: "",
    confidence: "high",
  };
}

function passage(lineIds: number[], text: string): Passage {
  return { lineIds, text, explanation: `${text} explained` };
}

function termPage(terms: Term[], passages: Passage[]): TermPage {
  return { page: 1, title: "A page", summary: "What this page does.", terms, passages, asrBias: [] };
}

function index(page: TermPage, extra: Partial<TermIndex> = {}): TermIndex {
  const glossary = page.terms.map((t) => ({
    id: t.id,
    term: t.term,
    aliases: t.aliases,
    kind: t.kind,
    definition: t.definition,
    intuition: t.intuition,
    inThisCourse: t.inThisCourse,
    pages: [1],
  }));
  return {
    schema: "terms/1",
    lectureId: "lec-test",
    course: "TEST",
    generated: "2026-09-12T10:00:00.000-04:00",
    pages: [page],
    glossary,
    ...extra,
  };
}

function sel(beginItem: number, endItem: number, text: string): LookupSelection {
  return { page: 1, beginItem, beginOffset: 0, endItem, endOffset: 0, text };
}

/* ------------------------------------------------------------------ */

describe("normalizeForMatch", () => {
  it("lower cases and collapses whitespace", () => {
    expect(normalizeForMatch("  Randomized   SMOOTHING \n")).toBe("randomized smoothing");
  });

  it("makes a hyphen and a space interchange", () => {
    expect(normalizeForMatch("trade-off")).toBe(normalizeForMatch("trade off"));
    expect(normalizeForMatch("ell–infinity")).toBe("ell infinity");
  });

  it("strips punctuation at the edges only", () => {
    expect(normalizeForMatch("• Take a majority vote.")).toBe("take a majority vote");
    // A digit is content, not furniture, so a numbered marker keeps its number.
    expect(normalizeForMatch("(1) bigger margin, bigger certificate.")).toBe(
      "1) bigger margin, bigger certificate",
    );
  });

  it("keeps the punctuation inside a notation, and the maths symbols around it", () => {
    expect(normalizeForMatch("‖x′−x‖∞ ≤ ε")).toBe("x′−x‖∞ ≤ ε");
  });
});

describe("lookup — no index", () => {
  const spans = spanPage(3);

  it("reports noIndex when there is no terms.json", () => {
    expect(lookup(sel(0, 0, "anything"), spans, null)).toEqual({ kind: "noIndex" });
  });

  it("reports noIndex when the index has no entry for this page", () => {
    const terms = index(termPage([term("a", "alpha", [0])], []));
    const other = { ...terms, pages: [{ ...(terms.pages[0] as TermPage), page: 9 }] };
    expect(lookup(sel(0, 0, "alpha"), spans, other)).toEqual({ kind: "noIndex" });
  });
});

describe("lookup — exact match", () => {
  const spans = spanPage(4);

  it("matches a term on the page by its canonical name", () => {
    const terms = index(termPage([term("a", "randomized smoothing", [2])], []));
    const result = lookup(sel(0, 0, "Randomized Smoothing"), spans, terms);
    expect(result).toMatchObject({ kind: "term", matchedBy: "exact" });
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-a");
    // The highlight follows the term, not the line the words were read on.
    expect(result.lineIds).toEqual([2]);
  });

  it("matches an alias, hyphen and case insensitively", () => {
    const terms = index(termPage([term("a", "ell infinity norm", [1], ["L-infinity"])], []));
    const result = lookup(sel(1, 1, "  l-INFINITY "), spans, terms);
    expect(result).toMatchObject({ kind: "term", matchedBy: "exact" });
  });

  it("takes a glossary hit whose id is not on this page", () => {
    const terms = index(termPage([term("a", "alpha", [0])], []));
    terms.glossary.push({
      id: "t-elsewhere",
      term: "certified radius",
      aliases: ["radius"],
      kind: "concept",
      definition: "The radius that is proved.",
      intuition: "How far the proof reaches.",
      inThisCourse: "",
      pages: [7],
    });
    const result = lookup(sel(3, 3, "certified radius"), spans, terms);
    expect(result).toMatchObject({ kind: "term", matchedBy: "exact" });
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-elsewhere");
    // It is not on this page, so the touched lines carry the highlight.
    expect(result.lineIds).toEqual([3]);
  });

  it("beats the passage preference: the words were the question", () => {
    const long = "certified radius";
    const terms = index(
      termPage([term("a", long, [0, 1, 2])], [passage([0, 1, 2], "a whole bullet group")]),
    );
    const result = lookup(sel(0, 2, long), spans, terms);
    expect(result.kind).toBe("term");
  });
});

describe("lookup — terms on the touched lines", () => {
  const spans = spanPage(8);

  it("ranks by overlap count, then by reading order", () => {
    const terms = index(
      termPage([term("wide", "wide term", [0, 1, 2]), term("narrow", "narrow term", [5])], []),
    );
    const result = lookup(sel(0, 2, "some words here"), spans, terms);
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-wide");
    expect(result.matchedBy).toBe("lines");
    expect(result.alsoTerms).toEqual([]);
  });

  it("breaks an overlap tie by the first line, then by first occurrence", () => {
    const terms = index(
      termPage(
        [term("late", "late term", [4]), term("early", "early term", [1]), term("also", "also term", [1])],
        [],
      ),
    );
    const result = lookup(sel(0, 5, "one two three four five"), spans, terms);
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-early");
    expect(result.alsoTerms.map((t) => t.id)).toEqual(["t-also", "t-late"]);
  });

  it("prefers a term the selection actually names over one that shares its line", () => {
    const terms = index(
      termPage(
        [term("broad", "randomized smoothing", [0, 1, 2, 3]), term("vote", "majority vote", [2])],
        [],
      ),
    );
    const result = lookup(sel(2, 2, "• Take a majority vote over the copies"), spans, terms);
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-vote");
    expect(result.matchedBy).toBe("lines");
    expect(result.alsoTerms.map((t) => t.id)).toEqual(["t-broad"]);
  });

  it("carries the intersecting passage alongside the term", () => {
    const terms = index(termPage([term("a", "alpha", [1])], [passage([1], "the line")]));
    const result = lookup(sel(1, 1, "alpha and more words"), spans, terms);
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.passage?.text).toBe("the line");
  });
});

describe("lookup — passages", () => {
  const spans = spanPage(8);

  it("leads with the passage when the selection runs past eight words", () => {
    const terms = index(
      termPage([term("a", "alpha", [0]), term("b", "beta", [1])], [passage([0, 1], "two lines")]),
    );
    const result = lookup(sel(0, 1, "one two three four five six seven eight nine"), spans, terms);
    expect(result).toMatchObject({ kind: "passage" });
    if (result.kind !== "passage") throw new Error("expected a passage");
    expect(result.passage.text).toBe("two lines");
    expect(result.lineIds).toEqual([0, 1]);
    expect(result.terms.map((t) => t.id)).toEqual(["t-a", "t-b"]);
  });

  it("leads with the passage when a short selection swallows all of its lines and names two terms", () => {
    const terms = index(
      termPage(
        [term("a", "ell infinity norm", [2], ["‖x′−x‖∞"]), term("b", "epsilon", [2], ["ε"])],
        [passage([2], "‖x′−x‖∞ ≤ ε")],
      ),
    );
    const result = lookup(sel(2, 2, "‖x′−x‖∞ ≤ ε"), spans, terms);
    expect(result.kind).toBe("passage");
    if (result.kind !== "passage") throw new Error("expected a passage");
    expect(result.terms.map((t) => t.term)).toEqual(["ell infinity norm", "epsilon"]);
  });

  it("stays on the term when a whole-passage selection names exactly one", () => {
    const terms = index(
      termPage(
        [term("a", "majority vote", [2]), term("b", "randomized smoothing", [0, 2])],
        [passage([2], "• Take a majority vote over the noisy copies")],
      ),
    );
    const result = lookup(sel(2, 2, "• Take a majority vote over the noisy copies"), spans, terms);
    expect(result).toMatchObject({ kind: "term", matchedBy: "lines" });
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.term).toBe("majority vote");
    expect(result.passage?.lineIds).toEqual([2]);
  });

  it("falls back to a passage when no term touches the lines", () => {
    const terms = index(termPage([term("a", "alpha", [7])], [passage([3], "a lonely line")]));
    const result = lookup(sel(3, 3, "a lonely"), spans, terms);
    expect(result).toMatchObject({ kind: "passage" });
    if (result.kind !== "passage") throw new Error("expected a passage");
    expect(result.terms).toEqual([]);
  });
});

describe("lookup — not in the index", () => {
  const spans = spanPage(4);

  it("returns the page summary and up to three near misses", () => {
    const terms = index(
      termPage([], []),
    );
    terms.glossary = ["smoothing one", "smoothing two", "smoothing three", "smoothing four"].map(
      (name, i) => ({
        id: `t-${i}`,
        term: name,
        aliases: [],
        kind: "concept" as const,
        definition: "d",
        intuition: "i",
        inThisCourse: "",
        pages: [1],
      }),
    );
    const result = lookup(sel(0, 0, "smoothing"), spans, terms);
    expect(result).toMatchObject({ kind: "summary" });
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.page.summary).toBe("What this page does.");
    expect(result.lineIds).toEqual([0]);
    expect(result.nearby).toHaveLength(3);
  });

  it("matches a near miss in the other direction too", () => {
    const terms = index(termPage([], []));
    terms.glossary = [
      {
        id: "t-x",
        term: "epsilon",
        aliases: [],
        kind: "concept",
        definition: "d",
        intuition: "i",
        inThisCourse: "",
        pages: [1],
      },
    ];
    const result = lookup(sel(0, 0, "the epsilon ball"), spans, terms);
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.nearby.map((g) => g.id)).toEqual(["t-x"]);
  });

  it("does not guess from one or two characters", () => {
    const terms = index(termPage([], []));
    terms.glossary = [
      {
        id: "t-x",
        term: "epsilon",
        aliases: ["ε"],
        kind: "notation",
        definition: "d",
        intuition: "i",
        inThisCourse: "",
        pages: [1],
      },
    ];
    const result = lookup(sel(0, 0, "ep"), spans, terms);
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.nearby).toEqual([]);
  });
});

describe("lookupTerm", () => {
  it("opens the cursored term as an exact hit on its own lines", () => {
    const spans = spanPage(4);
    const page = termPage([term("a", "alpha", [1, 2]), term("b", "beta", [2])], [passage([1, 2], "p")]);
    const result = lookupTerm(page.terms[0] as Term, page, spans);
    expect(result).toMatchObject({ kind: "term", matchedBy: "exact" });
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.lineIds).toEqual([1, 2]);
    expect(result.alsoTerms.map((t) => t.id)).toEqual(["t-b"]);
    expect(result.passage?.text).toBe("p");
  });
});

/* ------------------------------------------------------------------ */
/* The real prepared fixture: the same files the app and the e2e run on. */

function readFixture<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/lookup/${name}`, import.meta.url), "utf8"),
  ) as T;
}

describe("lookup — the prepared fixture deck", () => {
  const terms = TermIndexSchema.parse(readFixture("terms.json"));
  const spans = SpanIndexSchema.parse(readFixture("spans.json"));
  const spansFor = (n: number): SpanPage => {
    const page = spans.pages.find((p) => p.page === n);
    if (!page) throw new Error(`no spans for page ${n}`);
    return page;
  };
  const pageAt = (n: number): TermPage => {
    const page = terms.pages.find((p) => p.page === n);
    if (!page) throw new Error(`no terms for page ${n}`);
    return page;
  };

  it("walks page 2's terms in line order for the t cursor", () => {
    expect(termsOnPageInLineOrder(pageAt(2), spansFor(2)).map((t) => t.term)).toEqual([
      "randomized smoothing",
      "Gaussian noise",
      "certification time",
      "majority vote",
      "vote margin",
      "certified radius",
    ]);
  });

  it("explains the title of page 1 by an exact alias hit", () => {
    const result = lookup(
      { page: 1, beginItem: 0, beginOffset: 0, endItem: 2, endOffset: 11, text: "Certified Defenses" },
      spansFor(1),
      terms,
    );
    expect(result).toMatchObject({ kind: "term", matchedBy: "exact" });
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.id).toBe("t-certified-defense");
  });

  it("explains the majority-vote line as that term", () => {
    const result = lookup(
      {
        page: 2,
        beginItem: 9,
        beginOffset: 0,
        endItem: 9,
        endOffset: 44,
        text: "• Take a majority vote over the noisy copies",
      },
      spansFor(2),
      terms,
    );
    if (result.kind !== "term") throw new Error("expected a term");
    expect(result.term.term).toBe("majority vote");
    expect(result.lineIds).toEqual([4]);
    expect(result.page.page).toBe(2);
  });

  it("explains the threat-model line as a passage with its two terms as chips", () => {
    const result = lookup(
      { page: 3, beginItem: 7, beginOffset: 0, endItem: 7, endOffset: 11, text: "‖x′−x‖∞ ≤ ε" },
      spansFor(3),
      terms,
    );
    if (result.kind !== "passage") throw new Error("expected a passage");
    expect(result.passage.explanation).toContain("epsilon");
    expect(result.terms.map((t) => t.term)).toEqual(["ell infinity norm", "epsilon"]);
  });

  it("says nothing is in the index for the placeholder page", () => {
    const result = lookup(
      { page: 5, beginItem: 1, beginOffset: 0, endItem: 1, endOffset: 31, text: "Bravo comes second on the page." },
      spansFor(5),
      terms,
    );
    if (result.kind !== "summary") throw new Error("expected a summary");
    expect(result.page.summary).toContain("placeholder");
    expect(result.nearby).toEqual([]);
  });

  it("reads a backwards selection the same as a forwards one", () => {
    const forwards = lookup(
      { page: 2, beginItem: 9, beginOffset: 0, endItem: 9, endOffset: 44, text: "• Take a majority vote over the noisy copies" },
      spansFor(2),
      terms,
    );
    const backwards = lookup(
      { page: 2, beginItem: 9, beginOffset: 44, endItem: 9, endOffset: 0, text: "• Take a majority vote over the noisy copies" },
      spansFor(2),
      terms,
    );
    expect(backwards).toEqual(forwards);
  });
});
