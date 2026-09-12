import type { SpanPage } from "./schemas/spans.js";

/**
 * `[[deck.pdf#page=7]]` — a plain page link. These always resolve in Obsidian.
 */
export function pageLink(deckFile: string, page: number): string {
  return `[[${deckFile}#page=${page}]]`;
}

/**
 * `[[deck.pdf#page=7&selection=12,0,14,18|slide]]` — a selection link.
 *
 * The four selection numbers are Obsidian's `beginIndex, beginOffset,
 * endIndex, endOffset`, where the indexes are positions in pdf.js's text-item
 * array for that page (architecture.md §4.2). `display` is appended after a
 * pipe when given. See architecture.md §11: one Obsidian release had an
 * off-by-one in this index, so selection links are best effort and page links
 * are the fallback.
 */
export function selectionLink(
  deckFile: string,
  page: number,
  beginItem: number,
  beginOffset: number,
  endItem: number,
  endOffset: number,
  display?: string,
): string {
  const target = `${deckFile}#page=${page}&selection=${beginItem},${beginOffset},${endItem},${endOffset}`;
  return display === undefined ? `[[${target}]]` : `[[${target}|${display}]]`;
}

/**
 * A selection link covering whole lines: from the first item of the
 * lowest-numbered line at offset 0, to the last item of the highest-numbered
 * line at that item's string length.
 *
 * Returns a plain `pageLink` when `lineIds` is empty or names no line that
 * carries items, so callers never have to special-case it.
 */
export function lineSelectionLink(
  deckFile: string,
  page: number,
  spanPage: SpanPage,
  lineIds: number[],
  display?: string,
): string {
  const wanted = new Set(lineIds);
  const lines = spanPage.lines
    .filter((l) => wanted.has(l.id) && l.items.length > 0)
    .sort((a, b) => a.id - b.id);

  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) return pageLink(deckFile, page);

  const beginItem = first.items[0] as number;
  const endItem = last.items[last.items.length - 1] as number;
  const endStr = spanPage.items[endItem]?.str ?? "";
  return selectionLink(deckFile, page, beginItem, 0, endItem, endStr.length, display);
}
