import { describe, expect, it } from "vitest";
import { avgCharWidth, baselineOf, groupLines, joinLineText } from "../src/index.js";
import type { SpanItem } from "../src/index.js";

/**
 * Build an item from a top-left box. `h` defaults to 10, and the box width is
 * derived from the string length unless given, so a "character" is 6 units
 * wide and the thresholds work out to: baselines join within 5 units, items
 * join within a 15-unit gap, and a gap of 1.8 becomes a space.
 */
function item(
  id: number,
  str: string,
  left: number,
  top: number,
  opts: { w?: number; h?: number } = {},
): SpanItem {
  const h = opts.h ?? 10;
  const w = opts.w ?? str.length * 6;
  return {
    id,
    str,
    box: [left, top, w, h],
    transform: [h, 0, 0, h, left, top + h],
    font: "f1",
    eol: false,
  };
}

describe("baselineOf", () => {
  it("is the bottom edge of the mapped box", () => {
    expect(baselineOf(item(0, "x", 10, 20))).toBe(30);
  });
});

describe("avgCharWidth", () => {
  it("is width over string length", () => {
    expect(avgCharWidth(item(0, "abcd", 0, 0))).toBe(6);
  });

  it("treats an empty string as one character rather than dividing by zero", () => {
    expect(avgCharWidth(item(0, "", 0, 0, { w: 4 }))).toBe(4);
  });
});

describe("groupLines", () => {
  it("joins items that share a baseline and sit close together", () => {
    const lines = groupLines([item(0, "hello", 0, 0), item(1, "world", 40, 0)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.items).toEqual([0, 1]);
    expect(lines[0]?.text).toBe("hello world");
  });

  it("splits when the baselines differ by half the taller item's height or more", () => {
    // heights 10, so the cut is at 5: 4 joins, 6 does not.
    expect(groupLines([item(0, "a", 0, 0), item(1, "b", 20, 4)])).toHaveLength(1);
    expect(groupLines([item(0, "a", 0, 0), item(1, "b", 20, 6)])).toHaveLength(2);
  });

  it("splits when the horizontal gap exceeds 2.5 average character widths", () => {
    // avg char width 6, so the cut is at a 15-unit gap.
    const near = groupLines([item(0, "ab", 0, 0), item(1, "cd", 26, 0)]); // gap 14
    const far = groupLines([item(0, "ab", 0, 0), item(1, "cd", 28, 0)]); // gap 16
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(2);
    expect(far.map((l) => l.text)).toEqual(["ab", "cd"]);
  });

  it("skips items with an empty string but leaves their ids addressable", () => {
    const lines = groupLines([item(0, "", 0, 0, { w: 0 }), item(1, "text", 10, 0)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.items).toEqual([1]);
  });

  it("returns no lines when every item is empty", () => {
    expect(groupLines([item(0, "", 0, 0, { w: 0 })])).toEqual([]);
  });

  it("collapses a single-character run without inserting spaces", () => {
    // Adjacent single-character items, gap 0: "Wasser" + "stein", and a math run.
    const word = groupLines([item(0, "Wasser", 0, 0), item(1, "stein", 36, 0)]);
    expect(word[0]?.text).toBe("Wasserstein");

    const math = groupLines([
      item(0, "∫", 0, 0),
      item(1, "e", 6, 0),
      item(2, "−", 12, 0),
      item(3, "x", 18, 0),
    ]);
    expect(math).toHaveLength(1);
    expect(math[0]?.text).toBe("∫e−x");
    expect(math[0]?.kind).toBe("title"); // only line on the page, so it is also the tallest
  });

  it("inserts a space once the gap reaches 0.3 average character widths", () => {
    // "ab" ends at x=12 and the threshold is 0.3 * 6 = 1.8 units.
    expect(joinLineText([item(0, "ab", 0, 0), item(1, "cd", 13.8, 0)])).toBe("ab cd"); // gap 1.8
    expect(joinLineText([item(0, "ab", 0, 0), item(1, "cd", 13.7, 0)])).toBe("abcd"); // gap 1.7
  });

  it("orders lines top to bottom then left to right, ignoring item order", () => {
    const lines = groupLines([
      item(0, "delta", 0, 60),
      item(1, "bravo", 0, 20),
      item(2, "right", 400, 20),
      item(3, "alpha", 0, 0),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["alpha", "bravo", "right", "delta"]);
    expect(lines.map((l) => l.id)).toEqual([0, 1, 2, 3]);
  });

  it("keeps two columns apart on the same row", () => {
    const lines = groupLines([
      item(0, "left column", 0, 100),
      item(1, "right column", 400, 100),
    ]);
    expect(lines.map((l) => l.text)).toEqual(["left column", "right column"]);
  });

  it("unions the boxes of its items", () => {
    const lines = groupLines([item(0, "ab", 10, 20, { h: 10 }), item(1, "cd", 30, 18, { h: 12 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.box).toEqual([10, 18, 32, 12]);
  });

  it("collapses and trims whitespace in the joined text", () => {
    expect(groupLines([item(0, "  a \n b  ", 0, 0)])[0]?.text).toBe("a b");
  });

  describe("kinds", () => {
    it("calls the topmost line with the largest font height a title", () => {
      const lines = groupLines([
        item(0, "Heading", 0, 0, { h: 30 }),
        item(1, "body text here", 0, 60, { h: 10 }),
      ]);
      expect(lines[0]?.kind).toBe("title");
      expect(lines[1]?.kind).toBe("text");
    });

    it("marks a line math when it is mostly short items and has at least four", () => {
      const big = item(0, "Heading", 0, 0, { h: 30 });
      const run = ["x", "=", "y", "+", "z"].map((s, i) => item(i + 1, s, i * 6, 60));
      const lines = groupLines([big, ...run]);
      expect(lines[1]?.kind).toBe("math");

      // three short items is below the four-item floor
      const short = ["x", "=", "y"].map((s, i) => item(i + 1, s, i * 6, 60));
      expect(groupLines([big, ...short])[1]?.kind).toBe("text");
    });

    it("marks bullet and enumerated lines", () => {
      const big = item(0, "Heading", 0, 0, { h: 30 });
      const cases: Array<[string, string]> = [
        ["• first", "bullet"],
        ["◦ nested", "bullet"],
        ["– dashed", "bullet"],
        ["- hyphen", "bullet"],
        ["▪ square", "bullet"],
        ["‣ triangle", "bullet"],
        ["▶ Beamer subitem", "bullet"],
        ["▸ small triangle", "bullet"],
        ["► pointer", "bullet"],
        ["▹ white small triangle", "bullet"],
        ["➢ arrowhead", "bullet"],
        ["✓ check mark", "bullet"],
        ["* spaced asterisk", "bullet"],
        ["1) enumerated", "bullet"],
        ["2. enumerated", "bullet"],
        ["a) lettered", "bullet"],
        ["plain sentence", "text"],
        ["*args unpacked", "text"],
        ["*See the appendix", "text"],
        ["→ an arrow is not a bullet", "text"],
      ];
      for (const [text, kind] of cases) {
        const lines = groupLines([big, item(1, text, 0, 60)]);
        expect(lines[1]?.kind, text).toBe(kind);
      }
    });
  });

  it("classifies Beamer's ▶ marker as a bullet", () => {
    // U+25B6 is Beamer's default itemize marker; the LaTeX fixture is full of
    // them, and before it was in the list every one of them read as plain text.
    const heading = item(0, "Heading", 0, 0, { h: 30 });
    const lines = groupLines([heading, item(1, "▶ Subitem 1.1", 0, 60)]);
    expect(lines[1]?.text).toBe("▶ Subitem 1.1");
    expect(lines[1]?.kind).toBe("bullet");
  });

  it("is a pure function: the input array is untouched", () => {
    const items = [item(1, "b", 40, 0), item(0, "a", 0, 0)];
    const snapshot = JSON.stringify(items);
    groupLines(items);
    expect(JSON.stringify(items)).toBe(snapshot);
  });
});
