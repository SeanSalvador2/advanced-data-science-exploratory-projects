import type { SpanPage } from "../schemas/spans.js";

/**
 * Line ids whose items intersect the inclusive span-id range
 * `[beginItem, endItem]`. Backwards selections are normalised, so callers can
 * hand over the DOM's anchor/focus pair unsorted.
 */
export function linesTouched(page: SpanPage, beginItem: number, endItem: number): number[] {
  const lo = Math.min(beginItem, endItem);
  const hi = Math.max(beginItem, endItem);
  const touched: number[] = [];
  for (const line of page.lines) {
    if (line.items.some((id) => id >= lo && id <= hi)) touched.push(line.id);
  }
  return touched.sort((a, b) => a - b);
}

/** Every span id belonging to the given lines, ascending and deduplicated. */
export function itemsOfLines(page: SpanPage, lineIds: number[]): number[] {
  const wanted = new Set(lineIds);
  const out = new Set<number>();
  for (const line of page.lines) {
    if (!wanted.has(line.id)) continue;
    for (const id of line.items) out.add(id);
  }
  return [...out].sort((a, b) => a - b);
}
