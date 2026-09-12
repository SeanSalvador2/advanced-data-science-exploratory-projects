import type { Box, Transform } from "../schemas/common.js";

/**
 * The slice of a pdf.js `PageViewport` that box math needs. Callers pass the
 * viewport in so that `@lecture/core` never imports pdf.js and stays usable
 * from the browser app and from Node alike.
 */
export interface ViewportLike {
  width: number;
  height: number;
  convertToViewportPoint(x: number, y: number): number[];
}

/**
 * Axis-aligned bounding box of a pdf.js text item, in top-left-origin page
 * space at scale 1.
 *
 * The glyph box in PDF user space is `(e, f) .. (e + width, f + height)` where
 * `e = transform[4]` and `f = transform[5]`. All four corners are pushed
 * through `convertToViewportPoint` (`convertToViewportRectangle` was removed in
 * pdf.js 6.2, see phase-2-research.md §4) and the result is the min/max hull,
 * so page rotation and flipped axes are handled without special cases.
 */
export function itemBoxFromTransform(
  transform: Transform,
  width: number,
  height: number,
  pageViewportAtScale1: ViewportLike,
): Box {
  const e = transform[4];
  const f = transform[5];
  const corners: Array<[number, number]> = [
    [e, f],
    [e + width, f],
    [e, f + height],
    [e + width, f + height],
  ];

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of corners) {
    const p = pageViewportAtScale1.convertToViewportPoint(x, y);
    const px = p[0] as number;
    const py = p[1] as number;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  return [minX, minY, maxX - minX, maxY - minY];
}

/** Smallest box containing every box given. Throws on an empty list. */
export function unionBoxes(boxes: Box[]): Box {
  const first = boxes[0];
  if (first === undefined) throw new Error("unionBoxes: needs at least one box");
  let left = first[0];
  let top = first[1];
  let right = first[0] + first[2];
  let bottom = first[1] + first[3];
  for (let i = 1; i < boxes.length; i += 1) {
    const b = boxes[i] as Box;
    if (b[0] < left) left = b[0];
    if (b[1] < top) top = b[1];
    if (b[0] + b[2] > right) right = b[0] + b[2];
    if (b[1] + b[3] > bottom) bottom = b[1] + b[3];
  }
  return [left, top, right - left, bottom - top];
}
