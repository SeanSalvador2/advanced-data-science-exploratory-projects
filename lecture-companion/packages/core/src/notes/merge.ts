import { normalizeForMatch } from "../lookup/normalize.js";
import type { LectureNotes, Note, NotePage, OpenQuestion } from "../schemas/notes.js";

/** One `.lecture/notes.partial/*.json` file, tagged with where it came from. */
export interface NotesPartial {
  /** A label for error messages: the partial file's name. */
  source: string;
  pages: NotePage[];
  openQuestions: OpenQuestion[];
}

export type MergeNoteIssue =
  | { kind: "duplicate"; page: number; sources: string[] }
  | { kind: "out-of-range"; page: number; sources: string[] }
  | { kind: "invalid"; page: unknown; sources: string[] }
  /** Pages the transcript says were shown that no partial covers. */
  | { kind: "missing-shown"; pages: number[] };

export interface MergeNotePagesOptions {
  lectureId: string;
  generated: string;
  /** Let a page the transcript covers go un-noted instead of failing. */
  allowMissing?: boolean;
  /** Transcript spans per page, used to fill pages no partial covered. */
  spans?: ReadonlyMap<number, { startS: number; endS: number }>;
  /** Page titles, used to fill pages no partial covered. */
  titles?: ReadonlyMap<number, string>;
}

export interface MergeNotePagesResult {
  notes: LectureNotes;
  issues: MergeNoteIssue[];
  /** Deck pages no partial covered, whether or not that is an error. */
  uncovered: number[];
  /** Of those, the ones the transcript says were actually shown. */
  missingShown: number[];
  /** Open questions dropped because an earlier partial said the same thing. */
  duplicateQuestions: number;
}

/** A page that exists so `notes.json` mirrors the deck: shown, but nothing said. */
export function emptyNotePage(
  page: number,
  title: string,
  span: { startS: number; endS: number } | null,
): NotePage {
  return {
    page,
    title,
    startS: span === null ? null : span.startS,
    endS: span === null ? null : span.endS,
    notes: [],
  };
}

/**
 * Order the notes of one page the way a reader would have taken them: by the
 * moment they belong to. Student notes and generated notes interleave, because
 * a question typed at 13:41 belongs above the answer the professor gave at
 * 13:58 even though one is typed and one is transcribed.
 *
 * Notes with no time go last, in the order the model wrote them: they are
 * general remarks about the page, not moments in it.
 */
export function orderNotes(notes: readonly Note[]): Note[] {
  const timed: Array<{ note: Note; i: number }> = [];
  const untimed: Note[] = [];
  notes.forEach((note, i) => {
    if (note.tStart === null) untimed.push(note);
    else timed.push({ note, i });
  });
  timed.sort((a, b) => (a.note.tStart as number) - (b.note.tStart as number) || a.i - b.i);
  return [...timed.map((e) => e.note), ...untimed];
}

/** `n-<page>-<k>`, k counting from 1 in the order the page reads. */
export function noteId(page: number, k: number): string {
  return `n-${page}-${k}`;
}

/**
 * Merge every batch file into the pages of `notes.json`.
 *
 * Unlike the term index, a missing page is not automatically wrong: a page the
 * professor skipped has nothing to say, and a page they read out verbatim has
 * nothing to add. What *is* wrong is dropping a page that was shown and talked
 * over, so `spans` (the transcript's per-page coverage) decides: a page with
 * transcript and no partial is an error unless `allowMissing`.
 *
 * A page delivered twice is always an error, as it is for terms: two batches
 * disagreeing about a page means a re-run with different bounds.
 */
export function mergeNotePages(
  partials: readonly NotesPartial[],
  deckPages: number,
  opts: MergeNotePagesOptions,
): MergeNotePagesResult {
  const issues: MergeNoteIssue[] = [];
  const byPage = new Map<number, Array<{ source: string; page: NotePage }>>();
  const invalid = new Map<string, { page: unknown; sources: string[] }>();

  for (const partial of partials) {
    for (const page of partial.pages) {
      const n = page.page;
      if (!Number.isInteger(n)) {
        const key = JSON.stringify(n);
        const seen = invalid.get(key);
        if (seen === undefined) invalid.set(key, { page: n, sources: [partial.source] });
        else seen.sources.push(partial.source);
        continue;
      }
      const bucket = byPage.get(n);
      if (bucket === undefined) byPage.set(n, [{ source: partial.source, page }]);
      else bucket.push({ source: partial.source, page });
    }
  }

  for (const entry of invalid.values()) {
    issues.push({ kind: "invalid", page: entry.page, sources: entry.sources });
  }

  const numbers = [...byPage.keys()].sort((a, b) => a - b);
  for (const n of numbers) {
    const bucket = byPage.get(n) as Array<{ source: string; page: NotePage }>;
    if (bucket.length > 1) issues.push({ kind: "duplicate", page: n, sources: bucket.map((e) => e.source) });
  }
  for (const n of numbers) {
    if (n >= 1 && n <= deckPages) continue;
    const bucket = byPage.get(n) as Array<{ source: string; page: NotePage }>;
    issues.push({ kind: "out-of-range", page: n, sources: bucket.map((e) => e.source) });
  }

  const spans = opts.spans ?? new Map<number, { startS: number; endS: number }>();
  const titles = opts.titles ?? new Map<number, string>();
  const pages: NotePage[] = [];
  const uncovered: number[] = [];
  const missingShown: number[] = [];

  for (let n = 1; n <= deckPages; n += 1) {
    const bucket = byPage.get(n);
    if (bucket === undefined || bucket.length === 0) {
      uncovered.push(n);
      if (spans.has(n)) missingShown.push(n);
      pages.push(emptyNotePage(n, titles.get(n) ?? "", spans.get(n) ?? null));
      continue;
    }
    pages.push(canonicalNotePage(assignIds((bucket[0] as { page: NotePage }).page)));
  }

  if (missingShown.length > 0 && opts.allowMissing !== true) {
    issues.push({ kind: "missing-shown", pages: [...missingShown] });
  }

  const { questions, dropped } = mergeOpenQuestions(partials);

  return {
    notes: canonicalLectureNotes({
      schema: "notes/1",
      lectureId: opts.lectureId,
      generated: opts.generated,
      pages,
      openQuestions: questions,
    }),
    issues,
    uncovered,
    missingShown,
    duplicateQuestions: dropped,
  };
}

/** Re-number one page's notes: order them, then stamp `n-<page>-<k>`. */
export function assignIds(page: NotePage): NotePage {
  const ordered = orderNotes(page.notes);
  return {
    ...page,
    notes: ordered.map((note, i) => ({ ...note, id: noteId(page.page, i + 1) })),
  };
}

/**
 * Every partial's open questions, in file order, minus the ones a previous
 * partial already asked. Batches overlap at their seams — a question typed on
 * the last page of one batch is often still open on the first page of the next
 * — and the same sentence twice reads like the student asked twice.
 */
export function mergeOpenQuestions(
  partials: readonly NotesPartial[],
): { questions: OpenQuestion[]; dropped: number } {
  const seen = new Set<string>();
  const questions: OpenQuestion[] = [];
  let dropped = 0;
  for (const partial of partials) {
    for (const question of partial.openQuestions) {
      const key = normalizeForMatch(question.text);
      if (seen.has(key)) {
        dropped += 1;
        continue;
      }
      seen.add(key);
      questions.push(canonicalOpenQuestion(question));
    }
  }
  return { questions, dropped };
}

export function canonicalNote(note: Note): Note {
  return {
    id: note.id,
    kind: note.kind,
    text: note.text,
    lineIds: [...note.lineIds],
    termIds: [...note.termIds],
    tStart: note.tStart,
    tEnd: note.tEnd,
    ...(note.quote === undefined ? {} : { quote: note.quote }),
    tag: note.tag,
    ...(note.answer === undefined ? {} : { answer: note.answer }),
    confidence: note.confidence,
  };
}

export function canonicalNotePage(page: NotePage): NotePage {
  return {
    page: page.page,
    title: page.title,
    startS: page.startS,
    endS: page.endS,
    notes: page.notes.map(canonicalNote),
  };
}

export function canonicalOpenQuestion(question: OpenQuestion): OpenQuestion {
  return {
    text: question.text,
    page: question.page,
    source: question.source,
    tStart: question.tStart,
  };
}

/**
 * The whole `notes.json` document with every key in the order architecture.md
 * §4.7 lists it, so two runs over the same partials write identical bytes.
 */
export function canonicalLectureNotes(notes: LectureNotes): LectureNotes {
  return {
    schema: "notes/1",
    lectureId: notes.lectureId,
    generated: notes.generated,
    pages: [...notes.pages].sort((a, b) => a.page - b.page).map(canonicalNotePage),
    openQuestions: notes.openQuestions.map(canonicalOpenQuestion),
  };
}
