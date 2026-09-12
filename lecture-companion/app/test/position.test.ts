import { describe, expect, it } from "vitest";

import type { SpanPage } from "@lecture/core";

import { firstLineRect, placeCard, type Rect } from "../src/lookup/position.ts";
import { cursorReadout, stepCursor } from "../src/lookup/TermCursor.ts";

/** The 16:9 slide box of ui-direction.md §C, at the origin for easy arithmetic. */
const slide: Rect = { left: 100, top: 50, width: 1000, height: 600 };
const card = { width: 420, height: 200 };

describe("placeCard", () => {
  it("sits 12 px below an anchor in the upper half", () => {
    const anchor: Rect = { left: 300, top: 100, width: 260, height: 20 };
    expect(placeCard(anchor, slide, card)).toEqual({ left: 300, top: 132, flipped: false });
  });

  it("flips above when the anchor's centre is below the midline", () => {
    const anchor: Rect = { left: 300, top: 500, width: 260, height: 20 };
    expect(placeCard(anchor, slide, card)).toEqual({ left: 300, top: 288, flipped: true });
  });

  it("clamps to 24 px inside the left edge", () => {
    const anchor: Rect = { left: 104, top: 100, width: 40, height: 20 };
    expect(placeCard(anchor, slide, card).left).toBe(124);
  });

  it("clamps to 24 px inside the right edge", () => {
    const anchor: Rect = { left: 1000, top: 100, width: 60, height: 20 };
    expect(placeCard(anchor, slide, card).left).toBe(100 + 1000 - 24 - 420);
  });

  it("clamps to 24 px inside the bottom edge", () => {
    const tall = { width: 420, height: 320 };
    const anchor: Rect = { left: 300, top: 300, width: 260, height: 20 };
    // Just above the midline, so it wants to go below, but the bottom clamp wins.
    const placed = placeCard(anchor, slide, tall);
    expect(placed.top).toBe(50 + 600 - 24 - 320);
    expect(placed.top + tall.height).toBeLessThanOrEqual(slide.top + slide.height - 24);
  });

  it("never covers the line it explains, even at the bottom of the slide", () => {
    // 320 is the card's max height, so this is the worst real case.
    const tall = { width: 420, height: 320 };
    const anchor: Rect = { left: 300, top: 560, width: 260, height: 20 };
    const placed = placeCard(anchor, slide, tall);
    const clearsAbove = placed.top + tall.height <= anchor.top;
    const clearsBelow = placed.top >= anchor.top + anchor.height;
    expect(clearsAbove || clearsBelow).toBe(true);
  });
});

describe("firstLineRect", () => {
  const spans: SpanPage = {
    page: 2,
    width: 960,
    height: 540,
    items: [],
    lines: [
      { id: 0, items: [0], text: "title", box: [64.8, 51.8, 397.2, 30] },
      { id: 4, items: [9], text: "a bullet", box: [64.8, 207, 429.8, 19.5] },
    ],
  };

  it("scales a line box from user units into the rendered slide", () => {
    // A 1920-wide render of a 960-unit page: everything doubles.
    const rect = firstLineRect(spans, [4], { left: 10, top: 20, width: 1920, height: 1080 });
    expect(rect).toEqual({ left: 10 + 129.6, top: 20 + 414, width: 859.6, height: 39 });
  });

  it("takes the first line that exists, and null when none do", () => {
    const box = { left: 0, top: 0, width: 960, height: 540 };
    expect(firstLineRect(spans, [7, 0], box)?.top).toBe(51.8);
    expect(firstLineRect(spans, [7], box)).toBeNull();
  });
});

describe("stepCursor", () => {
  it("starts at the first term and wraps forwards", () => {
    expect(stepCursor(null, 1, 3)).toBe(0);
    expect(stepCursor(2, 1, 3)).toBe(0);
  });

  it("starts at the last term and wraps backwards", () => {
    expect(stepCursor(null, -1, 3)).toBe(2);
    expect(stepCursor(0, -1, 3)).toBe(2);
  });

  it("has nowhere to go on a slide with no terms", () => {
    expect(stepCursor(null, 1, 0)).toBeNull();
  });

  it("reads out one-based, with no middots", () => {
    const term = {
      id: "t-a",
      term: "majority vote",
      aliases: [],
      kind: "concept" as const,
      lineIds: [4],
      definition: "",
      intuition: "",
      inThisCourse: "",
      confidence: "high" as const,
    };
    expect(cursorReadout(2, 6, term)).toBe("term 3/6 majority vote");
  });
});
