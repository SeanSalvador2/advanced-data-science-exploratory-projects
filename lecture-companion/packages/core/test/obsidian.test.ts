import { describe, expect, it } from "vitest";
import {
  groupLines,
  itemsOfLines,
  lineSelectionLink,
  linesTouched,
  pageLink,
  selectionLink,
} from "../src/index.js";
import type { SpanItem, SpanPage } from "../src/index.js";

function item(id: number, str: string, left: number, top: number): SpanItem {
  return {
    id,
    str,
    box: [left, top, str.length * 6, 10],
    transform: [10, 0, 0, 10, left, top + 10],
    font: "f1",
    eol: false,
  };
}

/**
 * Three lines: ids 0..2 hold items [0,1], [2], [3,4].
 * Item 5 is empty, so it belongs to no line while keeping its id.
 */
function samplePage(): SpanPage {
  const items = [
    item(0, "randomized", 0, 0),
    item(1, "smoothing", 70, 0),
    item(2, "second line", 0, 40),
    item(3, "third", 0, 80),
    item(4, "line", 40, 80),
    { ...item(5, "x", 900, 500), str: "", box: [900, 500, 0, 10] as [number, number, number, number] },
  ];
  return { page: 7, width: 960, height: 540, items, lines: groupLines(items) };
}

describe("pageLink", () => {
  it("builds Obsidian's page link", () => {
    expect(pageLink("deck.pdf", 7)).toBe("[[deck.pdf#page=7]]");
  });
});

describe("selectionLink", () => {
  it("matches the form used in the Markdown export", () => {
    expect(selectionLink("deck.pdf", 7, 12, 0, 14, 18, "slide")).toBe(
      "[[deck.pdf#page=7&selection=12,0,14,18|slide]]",
    );
  });

  it("omits the display part when no display text is given", () => {
    expect(selectionLink("deck.pdf", 7, 12, 0, 14, 18)).toBe("[[deck.pdf#page=7&selection=12,0,14,18]]");
  });

  it("passes the deck file name through verbatim", () => {
    expect(selectionLink("Lectures/TDL/lec05/deck.pdf", 1, 0, 0, 0, 3)).toBe(
      "[[Lectures/TDL/lec05/deck.pdf#page=1&selection=0,0,0,3]]",
    );
  });
});

describe("lineSelectionLink", () => {
  const page = samplePage();

  it("spans the first item of the first line to the last item of the last line", () => {
    expect(page.lines.map((l) => l.items)).toEqual([[0, 1], [2], [3, 4]]);
    // line 0 starts at item 0; line 2 ends at item 4, whose string "line" is 4 long.
    expect(lineSelectionLink("deck.pdf", 7, page, [0, 2], "slide")).toBe(
      "[[deck.pdf#page=7&selection=0,0,4,4|slide]]",
    );
  });

  it("handles a single line", () => {
    expect(lineSelectionLink("deck.pdf", 7, page, [1])).toBe("[[deck.pdf#page=7&selection=2,0,2,11]]");
  });

  it("ignores the order the line ids are given in", () => {
    expect(lineSelectionLink("deck.pdf", 7, page, [2, 0])).toBe(
      lineSelectionLink("deck.pdf", 7, page, [0, 2]),
    );
  });

  it("falls back to a page link when no line is named", () => {
    expect(lineSelectionLink("deck.pdf", 7, page, [])).toBe("[[deck.pdf#page=7]]");
    expect(lineSelectionLink("deck.pdf", 7, page, [99])).toBe("[[deck.pdf#page=7]]");
  });
});

describe("linesTouched", () => {
  const page = samplePage();

  it("returns every line the span range intersects", () => {
    expect(linesTouched(page, 0, 0)).toEqual([0]);
    expect(linesTouched(page, 1, 2)).toEqual([0, 1]);
    expect(linesTouched(page, 0, 4)).toEqual([0, 1, 2]);
  });

  it("normalises a backwards selection", () => {
    expect(linesTouched(page, 4, 1)).toEqual(linesTouched(page, 1, 4));
  });

  it("returns nothing for a range that only covers an empty item", () => {
    expect(linesTouched(page, 5, 5)).toEqual([]);
  });
});

describe("itemsOfLines", () => {
  const page = samplePage();

  it("collects the span ids of the named lines, ascending", () => {
    expect(itemsOfLines(page, [2, 0])).toEqual([0, 1, 3, 4]);
  });

  it("ignores unknown line ids and returns nothing for none", () => {
    expect(itemsOfLines(page, [])).toEqual([]);
    expect(itemsOfLines(page, [42])).toEqual([]);
  });

  it("round-trips with linesTouched", () => {
    const ids = itemsOfLines(page, [1]);
    expect(linesTouched(page, ids[0] as number, ids[ids.length - 1] as number)).toEqual([1]);
  });
});
