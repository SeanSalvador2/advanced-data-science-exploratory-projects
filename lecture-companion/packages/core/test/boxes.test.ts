import { describe, expect, it } from "vitest";
import { itemBoxFromTransform, unionBoxes, type ViewportLike } from "../src/index.js";

/**
 * A stand-in for pdf.js's `PageViewport` at scale 1: PDF user space has its
 * origin bottom-left, the viewport top-left, so y flips about the page height.
 */
function flipViewport(width: number, height: number): ViewportLike {
  return { width, height, convertToViewportPoint: (x, y) => [x, height - y] };
}

/** A 90-degree rotated viewport, to prove the min/max hull is not assumed. */
function rotatedViewport(width: number, height: number): ViewportLike {
  return { width: height, height: width, convertToViewportPoint: (x, y) => [y, x] };
}

describe("itemBoxFromTransform", () => {
  it("maps an upright glyph box into top-left space", () => {
    // transform [a,b,c,d,e,f] with e=100, f=400 on a 540-tall page.
    const box = itemBoxFromTransform([12, 0, 0, 12, 100, 400], 60, 12, flipViewport(960, 540));
    expect(box).toEqual([100, 540 - 412, 60, 12]);
    expect(box[1] + box[3]).toBe(540 - 400); // bottom edge == the baseline
  });

  it("handles a zero-size item without producing NaN", () => {
    expect(itemBoxFromTransform([10, 0, 0, 10, 5, 5], 0, 0, flipViewport(100, 100))).toEqual([
      5, 95, 0, 0,
    ]);
  });

  it("takes the hull of all four corners under rotation", () => {
    const box = itemBoxFromTransform([12, 0, 0, 12, 100, 400], 60, 12, rotatedViewport(960, 540));
    // x and y swap, so the box width and height swap too.
    expect(box).toEqual([400, 100, 12, 60]);
  });

  it("uses the viewport's mapping, not the transform's a/b/c/d", () => {
    const calls: Array<[number, number]> = [];
    const vp: ViewportLike = {
      width: 10,
      height: 10,
      convertToViewportPoint: (x, y) => {
        calls.push([x, y]);
        return [x, y];
      },
    };
    itemBoxFromTransform([1, 2, 3, 4, 1, 2], 3, 4, vp);
    expect(calls).toEqual([
      [1, 2],
      [4, 2],
      [1, 6],
      [4, 6],
    ]);
  });
});

describe("unionBoxes", () => {
  it("covers every box given", () => {
    expect(
      unionBoxes([
        [10, 20, 5, 5],
        [0, 30, 40, 2],
      ]),
    ).toEqual([0, 20, 40, 12]);
  });

  it("is the identity on a single box", () => {
    expect(unionBoxes([[1, 2, 3, 4]])).toEqual([1, 2, 3, 4]);
  });

  it("throws on an empty list rather than returning nonsense", () => {
    expect(() => unionBoxes([])).toThrow(/at least one box/);
  });
});
