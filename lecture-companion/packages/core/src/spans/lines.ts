import type { Box } from "../schemas/common.js";
import type { SpanItem, SpanLine, SpanLineKind } from "../schemas/spans.js";
import { unionBoxes } from "./boxes.js";

/**
 * Thresholds for `groupLines`. The defaults are the numbers fixed by
 * architecture.md §4.2 and the task brief; they are named here so the unit
 * tests can read as prose.
 */
export const LINE_RULES = {
  /** Two items share a line while |Δbaseline| < this × the taller item's height. */
  baselineFactor: 0.5,
  /** ... and while the horizontal gap is < this × the average character width. */
  gapFactor: 2.5,
  /** A gap of at least this × the average character width becomes a space. */
  spaceFactor: 0.3,
  /** "math": at least this share of the line's items are <= 2 characters ... */
  mathShortShare: 0.6,
  /** ... and the line has at least this many items. */
  mathMinItems: 4,
  /**
   * Characters that mark a line as a bullet when it starts with one. The
   * triangles are what Beamer (U+25B6) and PowerPoint (U+25B8, U+25BA,
   * U+25B9, U+27A2, U+2713) actually emit for their itemize markers; without
   * them every bullet on a Beamer deck classifies as plain text.
   */
  bulletChars: [
    "•", // U+2022 bullet
    "◦", // U+25E6 white bullet
    "–", // U+2013 en dash
    "-", // hyphen-minus
    "▪", // U+25AA black small square
    "‣", // U+2023 triangular bullet
    "▶", // U+25B6 black right-pointing triangle, Beamer's itemize marker
    "▸", // U+25B8 black right-pointing small triangle
    "►", // U+25BA black right-pointing pointer
    "▹", // U+25B9 white right-pointing small triangle
    "➢", // U+27A2 three-d top-lighted rightwards arrowhead
    "✓", // U+2713 check mark
  ] as const,
  /** Relative tolerance when comparing font heights for the "title" heuristic. */
  heightTolerance: 1e-6,
} as const;

/**
 * The baseline of an item in top-left-origin page space.
 *
 * pdf.js reports the text-space baseline as `transform[5]`, but that value
 * lives in a bottom-left-origin space that page rotation may also flip. Rather
 * than re-deriving the mapping here, the baseline is taken as the *bottom edge*
 * of the already-mapped box (`top + height`). For unrotated text that is
 * exactly `transform[5]` mapped into top-left space; for rotated text it is the
 * consistent, monotone proxy the grouping rules need. Using it keeps
 * `@lecture/core` free of any viewport dependency.
 */
export function baselineOf(item: Pick<SpanItem, "box">): number {
  return item.box[1] + item.box[3];
}

function heightOf(item: Pick<SpanItem, "box">): number {
  return item.box[3];
}

/** Average character width of an item: its box width over its string length. */
export function avgCharWidth(item: Pick<SpanItem, "box" | "str">): number {
  return item.box[2] / Math.max(1, item.str.length);
}

/**
 * The character-width scale used when comparing two neighbours: the larger of
 * the two averages, so that a one-character neighbour (very common in LaTeX
 * math) never shrinks the threshold to nothing. Falls back to half the taller
 * box when both items are zero-width.
 */
function pairCharWidth(a: SpanItem, b: SpanItem): number {
  const w = Math.max(avgCharWidth(a), avgCharWidth(b));
  if (w > 0) return w;
  return Math.max(heightOf(a), heightOf(b)) * 0.5;
}

function sameBaseline(a: SpanItem, b: SpanItem): boolean {
  const tallest = Math.max(heightOf(a), heightOf(b));
  return Math.abs(baselineOf(a) - baselineOf(b)) < LINE_RULES.baselineFactor * tallest;
}

/** Signed horizontal gap from `a`'s right edge to `b`'s left edge. */
function gapBetween(a: SpanItem, b: SpanItem): number {
  return b.box[0] - (a.box[0] + a.box[2]);
}

const BULLET_CHARS = new Set<string>(LINE_RULES.bulletChars);
const ENUMERATOR = /^[0-9A-Za-z][).]/;

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Join the strings of a line. A single space is inserted where the gap between
 * two neighbours is at least `spaceFactor` average character widths; otherwise
 * the strings are concatenated, so that a word split across items ("Wasser" +
 * "stein") stays one word and a run of single-character math items does not get
 * spaced apart.
 */
export function joinLineText(items: SpanItem[]): string {
  let out = "";
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i] as SpanItem;
    if (i > 0) {
      const prev = items[i - 1] as SpanItem;
      if (gapBetween(prev, item) >= LINE_RULES.spaceFactor * pairCharWidth(prev, item)) {
        out += " ";
      }
    }
    out += item.str;
  }
  return collapseWhitespace(out);
}

function isBulletText(text: string): boolean {
  const first = text[0];
  if (first === undefined) return false;
  if (BULLET_CHARS.has(first)) return true;
  // A bare asterisk counts only when a space follows it, so that "*p", "*args"
  // and a footnote marker such as "*See appendix" stay plain text.
  if (first === "*") return text[1] === " ";
  return ENUMERATOR.test(text);
}

function isMathLine(items: SpanItem[]): boolean {
  if (items.length < LINE_RULES.mathMinItems) return false;
  const short = items.filter((it) => it.str.length <= 2).length;
  return short / items.length >= LINE_RULES.mathShortShare;
}

function lineFontHeight(items: SpanItem[]): number {
  let h = 0;
  for (const it of items) h = Math.max(h, heightOf(it));
  return h;
}

/**
 * Group a page's text items into lines in visual reading order.
 *
 * Items with an empty `str` are skipped: they keep their ids in `items[]` but
 * join no line. The remaining items are ordered geometrically (never by their
 * order in the PDF, which decks exported from Google Slides get wrong), rows
 * are cut where the baseline jumps, and each row is cut again where the
 * horizontal gap exceeds `gapFactor` average character widths — so a
 * two-column page yields two lines per row rather than one.
 */
export function groupLines(items: SpanItem[]): SpanLine[] {
  const candidates = items.filter((it) => it.str !== "");
  if (candidates.length === 0) return [];

  // Geometric order: top to bottom, then left to right, then by id so that
  // identical geometry never depends on sort stability.
  const ordered = [...candidates].sort((a, b) => {
    const ba = baselineOf(a);
    const bb = baselineOf(b);
    if (ba !== bb) return ba - bb;
    if (a.box[0] !== b.box[0]) return a.box[0] - b.box[0];
    return a.id - b.id;
  });

  // Pass 1: cut rows wherever two consecutive items fail the baseline test.
  const rows: SpanItem[][] = [];
  let row: SpanItem[] = [ordered[0] as SpanItem];
  for (let i = 1; i < ordered.length; i += 1) {
    const item = ordered[i] as SpanItem;
    const prev = ordered[i - 1] as SpanItem;
    if (sameBaseline(prev, item)) {
      row.push(item);
    } else {
      rows.push(row);
      row = [item];
    }
  }
  rows.push(row);

  // Pass 2: order each row left to right and cut it where the gap is too wide.
  const groups: SpanItem[][] = [];
  for (const r of rows) {
    const byX = [...r].sort((a, b) => (a.box[0] !== b.box[0] ? a.box[0] - b.box[0] : a.id - b.id));
    let group: SpanItem[] = [byX[0] as SpanItem];
    for (let i = 1; i < byX.length; i += 1) {
      const item = byX[i] as SpanItem;
      const prev = byX[i - 1] as SpanItem;
      const joins =
        sameBaseline(prev, item) &&
        gapBetween(prev, item) < LINE_RULES.gapFactor * pairCharWidth(prev, item);
      if (joins) {
        group.push(item);
      } else {
        groups.push(group);
        group = [item];
      }
    }
    groups.push(group);
  }

  // Reading order: top to bottom, then left to right.
  const sorted = groups
    .map((g) => ({ g, box: unionBoxes(g.map((it) => it.box)) }))
    .sort((a, b) => {
      if (a.box[1] !== b.box[1]) return a.box[1] - b.box[1];
      if (a.box[0] !== b.box[0]) return a.box[0] - b.box[0];
      return (a.g[0] as SpanItem).id - (b.g[0] as SpanItem).id;
    });

  // "title" is the topmost line whose font height is the largest on the page.
  const heights = sorted.map((s) => lineFontHeight(s.g));
  const maxHeight = heights.reduce((m, h) => Math.max(m, h), 0);
  const titleIndex = heights.findIndex(
    (h) => Math.abs(h - maxHeight) <= LINE_RULES.heightTolerance * Math.max(1, maxHeight),
  );

  return sorted.map((s, index) => {
    const text = joinLineText(s.g);
    let kind: SpanLineKind;
    if (index === titleIndex) kind = "title";
    else if (isMathLine(s.g)) kind = "math";
    else if (isBulletText(text)) kind = "bullet";
    else kind = "text";
    const line: SpanLine = {
      id: index,
      items: s.g.map((it) => it.id),
      text,
      box: s.box as Box,
      kind,
    };
    return line;
  });
}
