import type { Term } from "@lecture/core";

/**
 * The `t` fallback (ui-direction.md §D): a cursor that walks the slide's known
 * terms in line order, so lookup is reachable without a mouse. The cursor is
 * one index into `termsOnPageInLineOrder`; the wrap is what makes a long press
 * of `t` a loop rather than a dead end.
 */

/** The next cursor position, wrapping at both ends. Null when there is nothing to walk. */
export function stepCursor(index: number | null, direction: 1 | -1, total: number): number | null {
  if (total <= 0) return null;
  if (index === null) return direction === 1 ? 0 : total - 1;
  return (index + direction + total) % total;
}

/** The strip readout, sentence case and no middots: `term 3/9 majority vote`. */
export function cursorReadout(index: number, total: number, term: Term): string {
  return `term ${index + 1}/${total} ${term.term}`;
}
