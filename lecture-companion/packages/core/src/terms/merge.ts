import type { GlossaryEntry, Passage, Term, TermIndex, TermPage } from "../schemas/terms.js";
import { buildGlossary } from "./glossary.js";

/** One page as it arrived, tagged with the partial file it came from. */
export interface SourcedTermPage {
  /** A label for error messages: the partial file's name. */
  source: string;
  page: TermPage;
}

export type MergeIssue =
  | { kind: "duplicate"; page: number; sources: string[] }
  | { kind: "out-of-range"; page: number; sources: string[] }
  | { kind: "missing"; pages: number[] };

export interface MergeTermPagesResult {
  /** Pages 1..expectedPages, in order, when `issues` is empty. */
  pages: TermPage[];
  /** Pages that were absent and filled with an empty page (`allowMissing`). */
  filled: number[];
  issues: MergeIssue[];
}

export interface MergeTermPagesOptions {
  /** Fill absent pages with empty ones instead of reporting them. */
  allowMissing?: boolean;
}

/** A page that exists only so the deck has no holes: no title, no terms. */
export function emptyTermPage(page: number): TermPage {
  return { page, title: "", summary: "", terms: [], passages: [], asrBias: [] };
}

/**
 * Merge the pages of every `.lecture/terms.partial/*.json` into one ordered
 * run of pages 1..N.
 *
 * A page delivered twice is always an error: two batches disagreeing about a
 * page is a symptom of a re-run with different batch bounds, and silently
 * keeping one of them would hide it. A page nobody delivered is an error too
 * unless the caller opts into `allowMissing`.
 */
export function mergeTermPages(
  input: SourcedTermPage[],
  expectedPages: number,
  opts: MergeTermPagesOptions = {},
): MergeTermPagesResult {
  const byPage = new Map<number, SourcedTermPage[]>();
  for (const entry of input) {
    const bucket = byPage.get(entry.page.page);
    if (bucket === undefined) byPage.set(entry.page.page, [entry]);
    else bucket.push(entry);
  }

  const issues: MergeIssue[] = [];
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const bucket = byPage.get(page) as SourcedTermPage[];
    if (bucket.length > 1) {
      issues.push({ kind: "duplicate", page, sources: bucket.map((e) => e.source) });
    }
  }

  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    if (page >= 1 && page <= expectedPages) continue;
    const bucket = byPage.get(page) as SourcedTermPage[];
    issues.push({ kind: "out-of-range", page, sources: bucket.map((e) => e.source) });
  }

  const pages: TermPage[] = [];
  const filled: number[] = [];
  const missing: number[] = [];
  for (let n = 1; n <= expectedPages; n += 1) {
    const bucket = byPage.get(n);
    if (bucket === undefined || bucket.length === 0) {
      missing.push(n);
      filled.push(n);
      pages.push(emptyTermPage(n));
      continue;
    }
    pages.push(canonicalTermPage((bucket[0] as SourcedTermPage).page));
  }

  if (missing.length > 0 && opts.allowMissing !== true) {
    issues.push({ kind: "missing", pages: missing });
    return { pages, filled: [], issues };
  }
  return { pages, filled, issues };
}

/** A `TermPage` with its keys in the order architecture.md §4.3 lists them. */
export function canonicalTermPage(page: TermPage): TermPage {
  return {
    page: page.page,
    title: page.title,
    summary: page.summary,
    ...(page.overlayGroup === undefined ? {} : { overlayGroup: page.overlayGroup }),
    terms: page.terms.map(canonicalTerm),
    passages: page.passages.map(canonicalPassage),
    asrBias: [...page.asrBias],
  };
}

export function canonicalTerm(term: Term): Term {
  return {
    id: term.id,
    term: term.term,
    aliases: [...term.aliases],
    kind: term.kind,
    lineIds: [...term.lineIds],
    definition: term.definition,
    intuition: term.intuition,
    inThisCourse: term.inThisCourse,
    ...(term.firstSeen === undefined ? {} : { firstSeen: { ...term.firstSeen } }),
    confidence: term.confidence,
  };
}

export function canonicalPassage(passage: Passage): Passage {
  return {
    lineIds: [...passage.lineIds],
    text: passage.text,
    explanation: passage.explanation,
  };
}

export function canonicalGlossaryEntry(entry: GlossaryEntry): GlossaryEntry {
  return {
    id: entry.id,
    term: entry.term,
    aliases: [...entry.aliases],
    kind: entry.kind,
    definition: entry.definition,
    intuition: entry.intuition,
    inThisCourse: entry.inThisCourse,
    ...(entry.firstSeen === undefined ? {} : { firstSeen: { ...entry.firstSeen } }),
    pages: [...entry.pages],
  };
}

export interface BuildTermIndexInput {
  lectureId: string;
  course: string;
  generated: string;
  pages: TermPage[];
}

/**
 * The whole `terms.json` document, glossary included, with every key in a
 * fixed order so two runs over the same partials write identical bytes.
 */
export function buildTermIndex(input: BuildTermIndexInput): TermIndex {
  const pages = [...input.pages].sort((a, b) => a.page - b.page).map(canonicalTermPage);
  return {
    schema: "terms/1",
    lectureId: input.lectureId,
    course: input.course,
    generated: input.generated,
    pages,
    glossary: buildGlossary(pages).map(canonicalGlossaryEntry),
  };
}
