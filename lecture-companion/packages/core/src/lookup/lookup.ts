import type { SpanPage } from "../schemas/spans.js";
import type { GlossaryEntry, Passage, Term, TermIndex, TermPage } from "../schemas/terms.js";
import { linesTouched } from "../spans/selection.js";

import { containsWords, matchesExactly, matchWords, namedIn, normalizeForMatch } from "./normalize.js";

/**
 * A resolved selection on one page: the span-id range from the text layer plus
 * the text the student actually highlighted.
 *
 * Named `LookupSelection`, not `Selection`, because the app imports this next
 * to the DOM's own `Selection` in `SelectionWatcher`.
 */
export interface LookupSelection {
  page: number;
  beginItem: number;
  beginOffset: number;
  endItem: number;
  endOffset: number;
  text: string;
}

export type LookupResult =
  | {
      kind: "term";
      term: Term;
      page: TermPage;
      lineIds: number[];
      alsoTerms: Term[];
      passage?: Passage;
      matchedBy: "exact" | "lines";
    }
  | { kind: "passage"; passage: Passage; page: TermPage; lineIds: number[]; terms: Term[] }
  /** Nothing in the index answers this: the page summary plus a few near misses. */
  | { kind: "summary"; page: TermPage; lineIds: number[]; nearby: GlossaryEntry[] }
  /** No `terms.json` for this lecture, or no entry for this page. */
  | { kind: "noIndex" };

/** A selection longer than this is a question about a passage, not a word. */
const PASSAGE_WORDS = 8;
/** Below this, a substring search over the glossary is noise. */
const MIN_NEARBY_CHARS = 3;
const MAX_NEARBY = 3;

function names(term: Term | GlossaryEntry): string[] {
  return [term.term, ...term.aliases];
}

function overlap(lineIds: readonly number[], touched: ReadonlySet<number>): number {
  let count = 0;
  for (const id of lineIds) if (touched.has(id)) count += 1;
  return count;
}

/** The position of a term's first line in the page's reading order. */
function firstLineRank(lineIds: readonly number[], order: ReadonlyMap<number, number>): number {
  let best = Number.POSITIVE_INFINITY;
  for (const id of lineIds) {
    const rank = order.get(id) ?? id;
    if (rank < best) best = rank;
  }
  return best;
}

/** lineId -> index in `spans.lines`, which is reading order (architecture.md §4.2). */
function readingOrder(spans: SpanPage): Map<number, number> {
  const order = new Map<number, number>();
  spans.lines.forEach((line, i) => order.set(line.id, i));
  return order;
}

/**
 * The page's terms in the order the `t` cursor walks them: by the first line
 * they appear on, then by the order they were written into the page, which is
 * the order they first occur.
 */
export function termsOnPageInLineOrder(page: TermPage, spans: SpanPage): Term[] {
  const order = readingOrder(spans);
  return page.terms
    .map((term, index) => ({ term, index, rank: firstLineRank(term.lineIds, order) }))
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.term);
}

/** A glossary entry worn as a `Term`, for an exact hit that is not on this page. */
function termFromGlossary(entry: GlossaryEntry): Term {
  return {
    id: entry.id,
    term: entry.term,
    aliases: [...entry.aliases],
    kind: entry.kind,
    lineIds: [],
    definition: entry.definition,
    intuition: entry.intuition,
    inThisCourse: entry.inThisCourse,
    ...(entry.firstSeen === undefined ? {} : { firstSeen: { ...entry.firstSeen } }),
    confidence: "medium",
  };
}

/** The lines a term result highlights: where the term is, or what was touched. */
function highlightFor(term: Term, touched: number[]): number[] {
  return term.lineIds.length > 0 ? [...term.lineIds] : touched;
}

/** Terms of `page` whose lines intersect `lineIds`, in reading order. */
export function termsOnLines(page: TermPage, lineIds: readonly number[], spans: SpanPage): Term[] {
  const wanted = new Set(lineIds);
  const order = readingOrder(spans);
  return page.terms
    .map((term, index) => ({ term, index, rank: firstLineRank(term.lineIds, order) }))
    .filter((entry) => overlap(entry.term.lineIds, wanted) > 0)
    .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
    .map((entry) => entry.term);
}

/**
 * The lookup of architecture.md §7: a resolved selection, the page's spans and
 * the term index in, one card's worth of answer out. Pure; the app does the
 * DOM work either side of it.
 */
export function lookup(
  sel: LookupSelection,
  spans: SpanPage,
  terms: TermIndex | null,
): LookupResult {
  if (!terms) return { kind: "noIndex" };
  const page = terms.pages.find((p) => p.page === sel.page);
  if (!page) return { kind: "noIndex" };

  const touched = linesTouched(spans, sel.beginItem, sel.endItem);
  const touchedSet = new Set(touched);
  const normalized = normalizeForMatch(sel.text);
  const words = matchWords(sel.text);
  const order = readingOrder(spans);

  // 1. An exact term or alias hit, on this page first and then deck-wide. A
  //    glossary hit that is not on this page still counts: the student asked
  //    about the words, not about the lines.
  const exactHere = page.terms.find((term) => matchesExactly(names(term), normalized));
  const exactAnywhere =
    exactHere ??
    (() => {
      const entry = terms.glossary.find((g) => matchesExactly(names(g), normalized));
      if (!entry) return undefined;
      return page.terms.find((t) => t.id === entry.id) ?? termFromGlossary(entry);
    })();

  // 2. Candidates on the touched lines, best overlap first. A term the
  //    selection actually names outranks one that merely shares a line.
  const ranked = page.terms
    .map((term, index) => ({
      term,
      index,
      named: namedIn(names(term), words),
      count: overlap(term.lineIds, touchedSet),
      rank: firstLineRank(term.lineIds, order),
    }))
    .filter((c) => c.count > 0)
    .sort(
      (a, b) =>
        Number(b.named) - Number(a.named) ||
        b.count - a.count ||
        a.rank - b.rank ||
        a.index - b.index,
    );
  const candidates = ranked.map((c) => c.term);
  const namedCount = ranked.filter((c) => c.named).length;

  const passages = page.passages
    .map((passage, index) => ({
      passage,
      index,
      count: overlap(passage.lineIds, touchedSet),
      rank: firstLineRank(passage.lineIds, order),
      whole: passage.lineIds.length > 0 && passage.lineIds.every((id) => touchedSet.has(id)),
    }))
    .filter((p) => p.count > 0)
    .sort((a, b) => b.count - a.count || a.rank - b.rank || a.index - b.index);
  const whole = passages.find((p) => p.whole);

  if (exactAnywhere) {
    return {
      kind: "term",
      term: exactAnywhere,
      page,
      lineIds: highlightFor(exactAnywhere, touched),
      alsoTerms: candidates.filter((t) => t.id !== exactAnywhere.id),
      ...(passages[0] ? { passage: passages[0].passage } : {}),
      matchedBy: "exact",
    };
  }

  // 3. A long selection, or one that swallowed a whole passage without
  //    singling out one term, is a question about the passage
  //    (architecture.md §7 step 4).
  const preferPassage = words.length > PASSAGE_WORDS || (whole !== undefined && namedCount !== 1);
  const leadPassage = whole ?? passages[0];
  if (preferPassage && leadPassage) {
    return {
      kind: "passage",
      passage: leadPassage.passage,
      page,
      lineIds: [...leadPassage.passage.lineIds],
      terms: termsOnLines(page, leadPassage.passage.lineIds, spans),
    };
  }

  const best = candidates[0];
  if (best) {
    return {
      kind: "term",
      term: best,
      page,
      lineIds: highlightFor(best, touched),
      alsoTerms: candidates.slice(1),
      ...(leadPassage ? { passage: leadPassage.passage } : {}),
      matchedBy: "lines",
    };
  }

  if (leadPassage) {
    return {
      kind: "passage",
      passage: leadPassage.passage,
      page,
      lineIds: [...leadPassage.passage.lineIds],
      terms: termsOnLines(page, leadPassage.passage.lineIds, spans),
    };
  }

  // 4. Nothing in the index. Say so plainly, and offer the near misses.
  return { kind: "summary", page, lineIds: touched, nearby: nearbyEntries(terms, normalized) };
}

/** Glossary entries whose name contains the selection, or is contained by it. */
function nearbyEntries(terms: TermIndex, normalized: string): GlossaryEntry[] {
  if (normalized.length < MIN_NEARBY_CHARS) return [];
  const words = matchWords(normalized);
  const out: GlossaryEntry[] = [];
  for (const entry of terms.glossary) {
    const hit = names(entry).some((name) => {
      const other = normalizeForMatch(name);
      if (other === "") return false;
      return (
        other.includes(normalized) ||
        normalized.includes(other) ||
        containsWords(words, matchWords(name))
      );
    });
    if (hit) out.push(entry);
    if (out.length === MAX_NEARBY) break;
  }
  return out;
}

/** The card a `t`-cursored term opens: an exact hit by construction. */
export function lookupTerm(term: Term, page: TermPage, spans: SpanPage): LookupResult {
  const passage = page.passages.find((p) => p.lineIds.some((id) => term.lineIds.includes(id)));
  return {
    kind: "term",
    term,
    page,
    lineIds: highlightFor(term, []),
    alsoTerms: termsOnLines(page, term.lineIds, spans).filter((t) => t.id !== term.id),
    ...(passage ? { passage } : {}),
    matchedBy: "exact",
  };
}
