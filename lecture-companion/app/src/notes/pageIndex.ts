import type { LectureNotes, Note, NotePage, SpanLine } from "@lecture/core";

/**
 * Indexing `notes.json` for one page of review mode (architecture.md §4.7, §9).
 *
 * Everything here is pure and DOM-free: the note rail, the anchor layer and the
 * `]`/`[` navigation all read the same three facts — which pages carry notes,
 * which notes a page has in file order, and which slide lines each note points
 * at — and reciprocity is one `hoveredRef`/`activeRef` pair resolved against
 * them (ui-direction.md §E).
 */

/** One highlightable reference: a note, a glossary entry, or the lookup card. */
export interface AnchorRef {
  /** `data-ref`; every line box of one reference carries it. */
  id: string;
  lineIds: number[];
  state: AnchorState;
  /** Student ink, which takes the `--mine` fills rather than the amber ones. */
  mine?: boolean;
}

export type AnchorState = "resting" | "hover" | "active";

/** One drawn box: exactly one per visual line, whatever references it. */
export interface AnchorSpec {
  lineId: number;
  refId: string;
  state: AnchorState;
  mine: boolean;
  /** First line of its reference: the top corners round. */
  first: boolean;
  /** Last line of its reference: the bottom corners round. */
  last: boolean;
}

const RANK: Record<AnchorState, number> = { resting: 0, hover: 1, active: 2 };

export function notePageOf(notes: LectureNotes | null, page: number): NotePage | null {
  return notes?.pages.find((p) => p.page === page) ?? null;
}

/** The page's notes in `notes.json` order, which is the order they happened. */
export function notesOnPage(notes: LectureNotes | null, page: number): Note[] {
  return notePageOf(notes, page)?.notes ?? [];
}

/** Every page that has at least one note, ascending. */
export function pagesWithNotes(notes: LectureNotes | null): number[] {
  if (!notes) return [];
  return notes.pages
    .filter((p) => p.notes.length > 0)
    .map((p) => p.page)
    .sort((a, b) => a - b);
}

/**
 * `]` and `[`. A page with no notes is skipped, and the ends are walls: there
 * is nothing after the last noted page, so nothing happens (architecture.md §9).
 */
export function nextPageWithNotes(pages: readonly number[], from: number): number | null {
  return pages.find((p) => p > from) ?? null;
}

export function prevPageWithNotes(pages: readonly number[], from: number): number | null {
  let best: number | null = null;
  for (const p of pages) {
    if (p < from) best = p;
  }
  return best;
}

/** Where the open questions live: after the notes of the last noted page. */
export function lastPageWithNotes(pages: readonly number[]): number | null {
  return pages.length === 0 ? null : (pages[pages.length - 1] as number);
}

/** Note id by slide line, so hovering a line can find the notes that cite it. */
export function notesByLine(notes: readonly Note[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const note of notes) {
    for (const lineId of note.lineIds) {
      const bucket = out.get(lineId);
      if (bucket === undefined) out.set(lineId, [note.id]);
      else if (!bucket.includes(note.id)) bucket.push(note.id);
    }
  }
  return out;
}

/** Every line the page's notes point at, ascending: the resting underlines. */
export function referencedLines(notes: readonly Note[]): number[] {
  const seen = new Set<number>();
  for (const note of notes) for (const lineId of note.lineIds) seen.add(lineId);
  return [...seen].sort((a, b) => a - b);
}

/**
 * One box per visual line, never one per reference: two notes citing the same
 * line would otherwise stack two fills on it and the seam would show
 * (anti-pattern 9). The strongest state on a line wins — active over hover over
 * resting — and the reference that won is the one whose `data-ref` the box
 * carries and whose first and last lines decide the rounded corners.
 */
export function anchorSpecs(refs: readonly AnchorRef[]): AnchorSpec[] {
  const best = new Map<number, { ref: AnchorRef; rank: number }>();
  for (const ref of refs) {
    const rank = RANK[ref.state];
    for (const lineId of ref.lineIds) {
      const current = best.get(lineId);
      if (current === undefined || rank > current.rank) best.set(lineId, { ref, rank });
    }
  }

  const out: AnchorSpec[] = [];
  for (const [lineId, { ref }] of best) {
    const sorted = [...new Set(ref.lineIds)].sort((a, b) => a - b);
    out.push({
      lineId,
      refId: ref.id,
      state: ref.state,
      mine: ref.mine === true,
      first: sorted[0] === lineId,
      last: sorted[sorted.length - 1] === lineId,
    });
  }
  return out.sort((a, b) => a.lineId - b.lineId);
}

/**
 * Which referenced line a point is over, in PDF user units.
 *
 * The anchor layer takes no pointer events, so hover on the slide is one
 * `pointermove` on the stage tested against the line boxes rather than a
 * listener per box.
 */
export function lineAtPoint(
  lines: readonly SpanLine[],
  allowed: ReadonlySet<number>,
  x: number,
  y: number,
  pad = 2,
): number | null {
  let best: { id: number; area: number } | null = null;
  for (const line of lines) {
    if (!allowed.has(line.id)) continue;
    const [left, top, width, height] = line.box;
    if (x < left - pad || x > left + width + pad) continue;
    if (y < top - pad || y > top + height + pad) continue;
    const area = width * height;
    // The tightest box wins, so a short line inside a tall one still answers.
    if (best === null || area < best.area) best = { id: line.id, area };
  }
  return best === null ? null : best.id;
}
