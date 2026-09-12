import type { SpanPage } from "@lecture/core";

/**
 * Where the lookup card goes (ui-direction.md §C): 420 wide, anchored to the
 * first highlighted line box with a 12 px offset, flipped above when the
 * anchor sits below the slide's midline, clamped 24 px inside the slide box,
 * and never covering the line it explains.
 *
 * Everything here is in viewport pixels and free of the DOM, so the flip and
 * the clamps are unit-testable.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  left: number;
  top: number;
  /** True when the card sits above its anchor. */
  flipped: boolean;
}

export const CARD_WIDTH = 420;
export const CARD_MAX_HEIGHT = 320;
/** The gap between the anchor box and the card, and the leader's length. */
export const CARD_GAP = 12;
/** How far inside the slide box the card is kept. */
export const CARD_INSET = 24;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(value, hi));
}

function overlapsAnchor(top: number, height: number, anchor: Rect): boolean {
  return top < anchor.top + anchor.height && top + height > anchor.top;
}

/**
 * Place a card of `card.width` x `card.height` against `anchor` inside `slide`.
 */
export function placeCard(anchor: Rect, slide: Rect, card: { width: number; height: number }): Placement {
  const left = clamp(
    anchor.left,
    slide.left + CARD_INSET,
    slide.left + slide.width - CARD_INSET - card.width,
  );
  const lowest = slide.top + slide.height - CARD_INSET - card.height;
  const highest = slide.top + CARD_INSET;
  const below = clamp(anchor.top + anchor.height + CARD_GAP, highest, lowest);
  const above = clamp(anchor.top - CARD_GAP - card.height, highest, lowest);

  const anchorCentre = anchor.top + anchor.height / 2;
  const preferAbove = anchorCentre > slide.top + slide.height / 2;
  const first = preferAbove ? above : below;
  const second = preferAbove ? below : above;

  if (!overlapsAnchor(first, card.height, anchor)) {
    return { left, top: first, flipped: preferAbove };
  }
  if (!overlapsAnchor(second, card.height, anchor)) {
    return { left, top: second, flipped: !preferAbove };
  }
  // The card cannot avoid the line in this box; keep the side that was asked
  // for rather than inventing a third position.
  return { left, top: first, flipped: preferAbove };
}

/**
 * The rendered box of a reference's first line, in viewport pixels.
 *
 * `spans.json` boxes are PDF user units at scale 1, so the factor is the
 * rendered width over the page width (architecture.md §4.2).
 */
export function firstLineRect(spans: SpanPage, lineIds: number[], slide: Rect): Rect | null {
  if (spans.width <= 0) return null;
  const k = slide.width / spans.width;
  for (const id of lineIds) {
    const line = spans.lines.find((l) => l.id === id);
    if (!line) continue;
    return {
      left: slide.left + line.box[0] * k,
      top: slide.top + line.box[1] * k,
      width: line.box[2] * k,
      height: line.box[3] * k,
    };
  }
  return null;
}
