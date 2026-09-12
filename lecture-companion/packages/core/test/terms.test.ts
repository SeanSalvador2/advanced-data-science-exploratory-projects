import { describe, expect, it } from "vitest";
import {
  BiasTermsSchema,
  MAX_GLOBAL_BIAS_TERMS,
  MAX_PAGE_BIAS_TERMS,
  TermIndexSchema,
  buildGlossary,
  buildTermIndex,
  deriveBias,
  emptyTermPage,
  mergeTermPages,
  type Term,
  type TermIndex,
  type TermPage,
} from "../src/index.js";

function term(id: string, over: Partial<Term> = {}): Term {
  return {
    id,
    term: id.replace(/^t-/, "").replace(/-/g, " "),
    aliases: [],
    kind: "concept",
    lineIds: [],
    definition: `definition of ${id}`,
    intuition: `intuition of ${id}`,
    inThisCourse: "",
    confidence: "high",
    ...over,
  };
}

function page(n: number, terms: Term[], over: Partial<TermPage> = {}): TermPage {
  return { page: n, title: `page ${n}`, summary: "", terms, passages: [], asrBias: [], ...over };
}

function index(pages: TermPage[]): TermIndex {
  return buildTermIndex({
    lectureId: "lec05",
    course: "TDL",
    generated: "2026-09-15T20:14:00.000-04:00",
    pages,
  });
}

describe("buildGlossary", () => {
  it("keeps one entry per id, with the first page's text", () => {
    const glossary = buildGlossary([
      page(1, [term("t-smoothing", { definition: "the first one", inThisCourse: "as g(x)" })]),
      page(2, [term("t-smoothing", { definition: "a later, looser one", inThisCourse: "ignored" })]),
    ]);
    expect(glossary).toHaveLength(1);
    expect(glossary[0]?.definition).toBe("the first one");
    expect(glossary[0]?.inThisCourse).toBe("as g(x)");
  });

  it("reads pages in page-number order, not array order", () => {
    const glossary = buildGlossary([
      page(4, [term("t-radius", { definition: "fourth" })]),
      page(2, [term("t-radius", { definition: "second" })]),
    ]);
    expect(glossary[0]?.definition).toBe("second");
    expect(glossary[0]?.pages).toEqual([2, 4]);
  });

  it("unions aliases in the order they were first seen, without repeats", () => {
    const glossary = buildGlossary([
      page(1, [term("t-kl", { aliases: ["KL", "D_KL", "KL"] })]),
      page(2, [term("t-kl", { aliases: ["D_KL", "relative entropy"] })]),
      page(3, [term("t-kl", { aliases: ["KL divergence"] })]),
    ]);
    expect(glossary[0]?.aliases).toEqual(["KL", "D_KL", "relative entropy", "KL divergence"]);
  });

  it("lists every page the id appears on, sorted and deduplicated", () => {
    const glossary = buildGlossary([
      page(9, [term("t-a")]),
      page(3, [term("t-a"), term("t-a")]),
      page(11, [term("t-a")]),
    ]);
    expect(glossary[0]?.pages).toEqual([3, 9, 11]);
  });

  it("keeps the first occurrence's firstSeen and drops it when absent", () => {
    const glossary = buildGlossary([
      page(1, [term("t-a", { firstSeen: { lectureId: "lec04", page: 11 } }), term("t-b")]),
      page(2, [term("t-a"), term("t-b", { firstSeen: { lectureId: "lec01", page: 2 } })]),
    ]);
    expect(glossary[0]?.firstSeen).toEqual({ lectureId: "lec04", page: 11 });
    expect(glossary[1]?.firstSeen).toBeUndefined();
  });

  it("is empty for pages with no terms", () => {
    expect(buildGlossary([emptyTermPage(1), emptyTermPage(2)])).toEqual([]);
  });
});

describe("mergeTermPages", () => {
  const one = { source: "batch-01.json", page: page(1, []) };
  const two = { source: "batch-01.json", page: page(2, []) };
  const three = { source: "batch-02.json", page: page(3, []) };

  it("orders the pages and reports nothing when the deck is covered", () => {
    const merged = mergeTermPages([three, one, two], 3);
    expect(merged.issues).toEqual([]);
    expect(merged.pages.map((p) => p.page)).toEqual([1, 2, 3]);
    expect(merged.filled).toEqual([]);
  });

  it("reports a page delivered by two files, naming both", () => {
    const again = { source: "batch-02.json", page: page(2, []) };
    const merged = mergeTermPages([one, two, again, three], 3);
    expect(merged.issues).toEqual([
      { kind: "duplicate", page: 2, sources: ["batch-01.json", "batch-02.json"] },
    ]);
  });

  it("reports a page no file delivered", () => {
    const merged = mergeTermPages([one, three], 3);
    expect(merged.issues).toEqual([{ kind: "missing", pages: [2] }]);
    expect(merged.filled).toEqual([]);
  });

  it("fills the gaps instead when allowMissing is set", () => {
    const merged = mergeTermPages([one, three], 4, { allowMissing: true });
    expect(merged.issues).toEqual([]);
    expect(merged.filled).toEqual([2, 4]);
    expect(merged.pages[1]).toEqual(emptyTermPage(2));
  });

  it("reports a page that is not in the deck", () => {
    const merged = mergeTermPages([one, { source: "batch-09.json", page: page(9, []) }], 1);
    expect(merged.issues).toContainEqual({ kind: "out-of-range", page: 9, sources: ["batch-09.json"] });
  });
});

describe("buildTermIndex", () => {
  it("writes the keys in contract order, so two runs produce the same bytes", () => {
    const built = index([page(2, [term("t-a", { aliases: ["a"] })]), page(1, [])]);
    expect(Object.keys(built)).toEqual([
      "schema",
      "lectureId",
      "course",
      "generated",
      "pages",
      "glossary",
    ]);
    expect(Object.keys(built.pages[0] as TermPage)).toEqual([
      "page",
      "title",
      "summary",
      "terms",
      "passages",
      "asrBias",
    ]);
    expect(built.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(TermIndexSchema.safeParse(built).success).toBe(true);
  });

  it("keeps overlayGroup where it is set", () => {
    const built = index([page(1, [], { overlayGroup: 3 })]);
    expect(Object.keys(built.pages[0] as TermPage)).toContain("overlayGroup");
  });
});

describe("deriveBias", () => {
  it("uses the page's own asrBias, in order", () => {
    const bias = deriveBias(index([page(1, [term("t-a")], { asrBias: ["Wasserstein", "Sinkhorn"] })]));
    expect(bias.pages).toEqual([{ page: 1, terms: ["Wasserstein", "Sinkhorn"] }]);
    expect(bias.source).toBe("derived");
    expect(bias.deck).toBe("deck.pdf");
  });

  it("falls back to each term then its aliases, in term order", () => {
    const bias = deriveBias(
      index([
        page(1, [
          term("t-kl", { term: "KL divergence", aliases: ["D_KL", "relative entropy"] }),
          term("t-sigma", { term: "sigma", aliases: ["σ"] }),
        ]),
      ]),
    );
    expect(bias.pages[0]?.terms).toEqual([
      "KL divergence",
      "D_KL",
      "relative entropy",
      "sigma",
      "σ",
    ]);
  });

  it("drops repeats case-insensitively and keeps the first spelling", () => {
    const bias = deriveBias(
      index([page(1, [term("t-a")], { asrBias: ["Wasserstein", "  wasserstein ", "WASSERSTEIN", ""] })]),
    );
    expect(bias.pages[0]?.terms).toEqual(["Wasserstein"]);
  });

  it("caps each page and the global list", () => {
    const many = Array.from({ length: 70 }, (_, i) => `term-${i}`);
    const bias = deriveBias(index([page(1, [], { asrBias: many.slice(0, MAX_PAGE_BIAS_TERMS) })]), {
      maxPage: 5,
      maxGlobal: 3,
    });
    expect(bias.pages[0]?.terms).toHaveLength(5);

    const terms = many.map((t, i) => term(`t-${i}`, { term: t }));
    const full = deriveBias(index([page(1, terms)]));
    expect(full.pages[0]?.terms).toHaveLength(MAX_PAGE_BIAS_TERMS);
    expect(full.global).toHaveLength(MAX_GLOBAL_BIAS_TERMS);

    // Same caps when the global list comes from the pages' own asrBias.
    const spread = deriveBias(
      index([
        page(1, [], { asrBias: many.slice(0, MAX_PAGE_BIAS_TERMS) }),
        page(2, [], { asrBias: many.slice(MAX_PAGE_BIAS_TERMS) }),
      ]),
    );
    expect(spread.global).toHaveLength(MAX_GLOBAL_BIAS_TERMS);
  });

  it("builds the global list from the pages' asrBias, ranked by page count", () => {
    const bias = deriveBias(
      index([
        page(1, [], { asrBias: ["radius", "sigma"] }),
        page(2, [], { asrBias: ["radius"] }),
        page(3, [], { asrBias: ["radius", "probit"] }),
      ]),
    );
    expect(bias.global).toEqual(["radius", "sigma", "probit"]);
  });

  it("breaks ties by first page, then by rank within that page", () => {
    const bias = deriveBias(
      index([
        page(1, [], { asrBias: ["shared", "first-page-top", "first-page-tail"] }),
        page(2, [], { asrBias: ["shared", "second-page"] }),
      ]),
    );
    // "shared" is on two pages; the rest tie at one and keep page order, then
    // the order their own page ranked them in.
    expect(bias.global).toEqual(["shared", "first-page-top", "first-page-tail", "second-page"]);
  });

  it("never lets an alias no page asked for into the global list", () => {
    const bias = deriveBias(
      index([
        page(1, [term("t-sigma", { term: "sigma", aliases: ["σ", "noise scale"] })], {
          asrBias: ["sigma"],
        }),
        page(2, [term("t-vote", { term: "majority vote", aliases: ["vote"] })], {
          asrBias: ["majority vote"],
        }),
      ]),
    );
    expect(bias.global).toEqual(["sigma", "majority vote"]);
    expect(bias.global).not.toContain("σ");
    expect(bias.global).not.toContain("noise scale");
    expect(bias.global).not.toContain("vote");
  });

  it("falls back to glossary names, never aliases, when no page has an asrBias", () => {
    const bias = deriveBias(
      index([
        page(1, [term("t-sigma", { term: "sigma", aliases: ["σ"] })]),
        page(2, [
          term("t-sigma", { term: "sigma", aliases: ["σ"] }),
          term("t-probit", { term: "probit", aliases: ["Φ⁻¹"] }),
        ]),
      ]),
    );
    // The per-page lists still fall back to terms plus aliases ...
    expect(bias.pages[0]?.terms).toEqual(["sigma", "σ"]);
    // ... but the deck-wide list is names only, most-used first.
    expect(bias.global).toEqual(["sigma", "probit"]);
  });

  it("drops repeats across pages case-insensitively, keeping the first spelling", () => {
    const bias = deriveBias(
      index([
        page(1, [], { asrBias: ["Wasserstein"] }),
        page(2, [], { asrBias: ["  wasserstein ", "Sinkhorn"] }),
      ]),
    );
    expect(bias.global).toEqual(["Wasserstein", "Sinkhorn"]);
  });

  it("emits an entry for every page, including the ones with nothing on them", () => {
    const bias = deriveBias(index([page(1, [term("t-a")]), emptyTermPage(2)]));
    expect(bias.pages.map((p) => p.page)).toEqual([1, 2]);
    expect(bias.pages[1]?.terms).toEqual([]);
  });

  it("produces a document the BiasTerms schema accepts", () => {
    const bias = deriveBias(index([page(1, [term("t-a", { aliases: ["A"] })])]));
    expect(BiasTermsSchema.safeParse(bias).success).toBe(true);
  });
});

describe("BiasTermsSchema", () => {
  const valid = {
    schema: "bias/1",
    deck: "deck.pdf",
    source: "derived",
    pages: [{ page: 1, terms: ["Wasserstein"] }],
    global: ["Wasserstein"],
  };

  it("accepts all three producers", () => {
    for (const source of ["heuristic", "claude", "derived"]) {
      expect(BiasTermsSchema.safeParse({ ...valid, source }).success).toBe(true);
    }
    expect(BiasTermsSchema.safeParse({ ...valid, source: "guesswork" }).success).toBe(false);
  });

  it("accepts a file with no schema string, as /lecture-bias-terms writes it", () => {
    const { schema: _schema, ...rest } = valid;
    expect(BiasTermsSchema.safeParse(rest).success).toBe(true);
  });

  it("refuses another deck name", () => {
    expect(BiasTermsSchema.safeParse({ ...valid, deck: "slides.pdf" }).success).toBe(false);
  });

  it("refuses more than the caps the spike enforces", () => {
    const long = (n: number): string[] => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(
      BiasTermsSchema.safeParse({ ...valid, pages: [{ page: 1, terms: long(MAX_PAGE_BIAS_TERMS + 1) }] })
        .success,
    ).toBe(false);
    expect(BiasTermsSchema.safeParse({ ...valid, global: long(MAX_GLOBAL_BIAS_TERMS + 1) }).success).toBe(
      false,
    );
    expect(
      BiasTermsSchema.safeParse({ ...valid, pages: [{ page: 1, terms: long(MAX_PAGE_BIAS_TERMS) }] })
        .success,
    ).toBe(true);
  });

  it("refuses a page number below one", () => {
    expect(BiasTermsSchema.safeParse({ ...valid, pages: [{ page: 0, terms: [] }] }).success).toBe(false);
  });
});
