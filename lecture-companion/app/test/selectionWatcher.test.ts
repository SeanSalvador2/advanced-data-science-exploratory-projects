// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { readSelection, type SelectionLike } from "../src/selection/SelectionWatcher.ts";
import type { DivIndex } from "../src/pdf/resolve.ts";

/**
 * The same DOM shape pdf.js builds: one entry in `textDivs` per string-bearing
 * item, empty ones included, only the non-empty spans in the DOM, and a `<br>`
 * after every end-of-line item.
 */
function buildLayer(items: Array<{ str: string; eol?: boolean }>): {
  container: HTMLElement;
  index: DivIndex;
} {
  const container = document.createElement("div");
  container.className = "textLayer";
  const divs: HTMLElement[] = [];
  const indexOfDiv = new WeakMap<HTMLElement, number>();

  items.forEach((item, i) => {
    const span = document.createElement("span");
    span.textContent = item.str;
    divs.push(span);
    indexOfDiv.set(span, i);
    if (item.str !== "") container.append(span);
    if (item.eol) container.append(document.createElement("br"));
  });

  document.body.replaceChildren(container);
  return { container, index: { divs, indexOfDiv } };
}

function textOf(el: HTMLElement): Text {
  return el.firstChild as Text;
}

/** A `Selection` as far as `readSelection` is concerned. */
function selection(
  anchorNode: Node | null,
  anchorOffset: number,
  focusNode: Node | null,
  focusOffset: number,
  text: string,
): SelectionLike {
  return {
    anchorNode,
    anchorOffset,
    focusNode,
    focusOffset,
    isCollapsed: anchorNode === focusNode && anchorOffset === focusOffset,
    rangeCount: 1,
    toString: () => text,
  };
}

describe("readSelection", () => {
  it("maps a forward selection across two items to a span range", () => {
    const { index } = buildLayer([
      { str: "Add Gaussian noise" },
      { str: "" },
      { str: "at prediction time", eol: true },
    ]);
    const first = index.divs[0] as HTMLElement;
    const third = index.divs[2] as HTMLElement;

    const result = readSelection({
      index,
      page: 2,
      selection: selection(textOf(first), 4, textOf(third), 3, "Gaussian noise at "),
    });

    expect(result).toEqual({
      page: 2,
      beginItem: 0,
      beginOffset: 4,
      endItem: 2,
      endOffset: 3,
      text: "Gaussian noise at ",
    });
  });

  it("sorts a backwards selection into the same range", () => {
    const { index } = buildLayer([{ str: "majority vote", eol: true }]);
    const div = index.divs[0] as HTMLElement;

    const forwards = readSelection({
      index,
      page: 2,
      selection: selection(textOf(div), 0, textOf(div), 13, "majority vote"),
    });
    const backwards = readSelection({
      index,
      page: 2,
      selection: selection(textOf(div), 13, textOf(div), 0, "majority vote"),
    });

    expect(backwards).toEqual(forwards);
    expect(backwards).toMatchObject({ beginItem: 0, beginOffset: 0, endOffset: 13 });
  });

  it("walks a <br> endpoint back onto the item it follows", () => {
    const { container, index } = buildLayer([
      { str: "first line", eol: true },
      { str: "second line" },
    ]);
    const first = index.divs[0] as HTMLElement;
    // The end of a line-spanning drag lands on the container, at the index of
    // the <br> pdf.js inserted after the end-of-line item.
    const brIndex = Array.from(container.childNodes).findIndex((n) => n.nodeName === "BR");
    expect(brIndex).toBeGreaterThan(0);

    const result = readSelection({
      index,
      page: 1,
      selection: selection(textOf(first), 0, container, brIndex, "first line"),
    });

    expect(result).toMatchObject({ beginItem: 0, beginOffset: 0, endItem: 0, endOffset: 10 });
  });

  it("returns null for a collapsed selection, for none at all, and for whitespace", () => {
    const { index } = buildLayer([{ str: "alpha" }]);
    const div = index.divs[0] as HTMLElement;
    expect(readSelection({ index, page: 1, selection: null })).toBeNull();
    expect(
      readSelection({ index, page: 1, selection: selection(textOf(div), 2, textOf(div), 2, "") }),
    ).toBeNull();
    expect(
      readSelection({
        index,
        page: 1,
        selection: { ...selection(textOf(div), 0, textOf(div), 3, "   "), isCollapsed: false },
      }),
    ).toBeNull();
  });

  it("falls back to the caret under the pointer when a drag began on the canvas", () => {
    const { index } = buildLayer([{ str: "on the slide" }]);
    const div = index.divs[0] as HTMLElement;
    const canvas = document.createElement("canvas");
    document.body.append(canvas);

    const caret = {
      caretPositionFromPoint: (x: number, y: number) => {
        expect([x, y]).toEqual([120, 240]);
        return { offsetNode: textOf(div), offset: 2 };
      },
    };

    const result = readSelection({
      index,
      page: 3,
      // The drag started on the canvas, so that endpoint resolves to nothing.
      selection: selection(canvas, 0, textOf(div), 9, "the slid"),
      point: { x: 120, y: 240 },
      caret,
    });

    expect(result).toMatchObject({ beginItem: 0, beginOffset: 2, endItem: 0, endOffset: 9 });
  });

  it("gives up when neither endpoint is in the text layer and there is no caret", () => {
    const { index } = buildLayer([{ str: "on the slide" }]);
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    expect(
      readSelection({
        index,
        page: 3,
        selection: { ...selection(canvas, 0, canvas, 1, "anything"), isCollapsed: false },
      }),
    ).toBeNull();
  });
});
