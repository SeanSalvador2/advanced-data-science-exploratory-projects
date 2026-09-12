import {
  MAX_GLOBAL_BIAS_TERMS,
  MAX_PAGE_BIAS_TERMS,
  type BiasTerms,
  type BiasPageTerms,
} from "../schemas/bias.js";
import type { GlossaryEntry, TermIndex, TermPage } from "../schemas/terms.js";

export interface DeriveBiasOptions {
  /** Terms kept per page. Default 40, the cap the spike enforces. */
  maxPage?: number;
  /** Terms kept in `global`. Default 60. */
  maxGlobal?: number;
}

/**
 * Derive `bias.json` from `terms.json` (architecture.md §4.3): the page lists
 * are the term index's own `asrBias`, and the deck-wide list is the vocabulary
 * those page lists have in common. Nothing here is a judgement call, so the
 * same term index always yields the same bias file.
 *
 * Both lists hold spoken spellings only. Aliases are the lookup layer's
 * business — they exist so a highlighted `σ²` finds its term — and a printed
 * glyph or a stray fragment like "vote" is worse than useless in a speech
 * prompt, which is budgeted in words. So aliases reach `bias.json` only where
 * a page has no `asrBias` at all and its terms are the only guess available.
 */
export function deriveBias(index: TermIndex, opts: DeriveBiasOptions = {}): BiasTerms {
  const maxPage = opts.maxPage ?? MAX_PAGE_BIAS_TERMS;
  const maxGlobal = opts.maxGlobal ?? MAX_GLOBAL_BIAS_TERMS;

  const ordered = [...index.pages].sort((a, b) => a.page - b.page);
  const pages: BiasPageTerms[] = ordered.map((page) => ({
    page: page.page,
    terms: dedupeTerms(pageCandidates(page), maxPage),
  }));

  const fromPages = globalFromPages(ordered);
  const candidates = fromPages.length > 0 ? fromPages : globalFromGlossary(index.glossary);

  return {
    schema: "bias/1",
    deck: "deck.pdf",
    source: "derived",
    pages,
    global: dedupeTerms(candidates, maxGlobal),
  };
}

/** `asrBias` if the page has one, otherwise each term's name then its aliases. */
function pageCandidates(page: TermPage): string[] {
  if (page.asrBias.length > 0) return page.asrBias;
  const out: string[] = [];
  for (const term of page.terms) {
    out.push(term.term, ...term.aliases);
  }
  return out;
}

interface GlobalCandidate {
  /** The first spelling seen, which is the one that is emitted. */
  term: string;
  /** Distinct pages whose `asrBias` holds it. */
  pages: Set<number>;
  firstPage: number;
  /** Rank within that first page's list, the author's own ordering. */
  position: number;
}

/**
 * The deck-wide list: every spelling any page asked for, most widely spoken
 * first. A term the whole deck keeps saying is the one the transcriber most
 * needs when it does not know which slide is up; ties are broken by the page
 * that said it first, and then by where its author ranked it on that page.
 */
function globalFromPages(pages: TermPage[]): string[] {
  const byKey = new Map<string, GlobalCandidate>();
  for (const page of pages) {
    page.asrBias.forEach((raw, position) => {
      const term = normalizeTerm(raw);
      if (term === "") return;
      const key = term.toLowerCase();
      const found = byKey.get(key);
      if (found === undefined) {
        byKey.set(key, { term, pages: new Set([page.page]), firstPage: page.page, position });
        return;
      }
      found.pages.add(page.page);
    });
  }
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.pages.size !== b.pages.size) return b.pages.size - a.pages.size;
      if (a.firstPage !== b.firstPage) return a.firstPage - b.firstPage;
      return a.position - b.position;
    })
    .map((c) => c.term);
}

/**
 * The fallback for a term index whose pages carry no `asrBias` at all: the
 * glossary's canonical names, most-used first. Names only — an alias is a
 * printed form or a fragment, and neither belongs in a speech prompt.
 */
function globalFromGlossary(glossary: GlossaryEntry[]): string[] {
  return [...glossary]
    .sort((a, b) => {
      if (a.pages.length !== b.pages.length) return b.pages.length - a.pages.length;
      return (a.pages[0] ?? Number.MAX_SAFE_INTEGER) - (b.pages[0] ?? Number.MAX_SAFE_INTEGER);
    })
    .map((entry) => entry.term);
}

/** One spelling, trimmed, with runs of whitespace collapsed. */
function normalizeTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Trim, drop blanks, drop repeats case-insensitively (keeping the first
 * spelling, which is the ranked one), cap.
 */
export function dedupeTerms(values: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const term = normalizeTerm(raw);
    if (term === "") continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= cap) break;
  }
  return out;
}
