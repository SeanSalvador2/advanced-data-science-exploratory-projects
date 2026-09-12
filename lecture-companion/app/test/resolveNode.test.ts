// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { resolveNode, type DivIndex } from "../src/pdf/resolve.ts";

/**
 * Build the DOM shape pdf.js produces: `textDivs` holds one span per
 * string-bearing item *including the empty ones*, but only the non-empty spans
 * are appended to the container, and a `<br>` follows every item that ended a
 * line. So the DOM child index is not the span id, which is the whole point of
 * the map this resolves through.
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

  return { container, index: { divs, indexOfDiv } };
}

const items = [
  { str: "Randomized " },
  { str: "smoothing", eol: true },
  { str: "" },
  { str: "turns any classifier" },
];

describe("resolveNode", () => {
  it("resolves a text node to its span id and character offset", () => {
    const { index } = buildLayer(items);
    const span = index.divs[1] as HTMLElement;
    const text = span.firstChild as Text;
    expect(resolveNode(index, text, 4)).toEqual({ itemId: 1, offset: 4 });
  });

  it("returns the span id, not the DOM child index", () => {
    const { container, index } = buildLayer(items);
    // Item 3 is only the third *appended* child, because item 2 is empty.
    const appended = [...container.children].filter((c) => c.tagName === "SPAN");
    expect(appended).toHaveLength(3);
    const last = appended[2] as HTMLElement;
    expect(resolveNode(index, last.firstChild, 0)).toEqual({ itemId: 3, offset: 0 });
  });

  it("clamps an offset past the end of the string", () => {
    const { index } = buildLayer(items);
    const span = index.divs[0] as HTMLElement;
    expect(resolveNode(index, span.firstChild, 999)).toEqual({ itemId: 0, offset: 11 });
  });

  it("handles an endpoint on the span element itself", () => {
    const { index } = buildLayer(items);
    const span = index.divs[1] as HTMLElement;
    expect(resolveNode(index, span, 0)).toEqual({ itemId: 1, offset: 0 });
    expect(resolveNode(index, span, 1)).toEqual({ itemId: 1, offset: 9 });
  });

  it("handles an endpoint on a line break, mapping it to the end of the line", () => {
    const { container, index } = buildLayer(items);
    const br = container.querySelector("br") as HTMLElement;
    expect(resolveNode(index, br, 0)).toEqual({ itemId: 1, offset: 9 });
  });

  it("handles an endpoint on the container, using the child the offset points at", () => {
    const { container, index } = buildLayer(items);
    expect(resolveNode(index, container, 0)).toEqual({ itemId: 0, offset: 0 });
    const atEnd = resolveNode(index, container, container.childNodes.length);
    expect(atEnd).toEqual({ itemId: 3, offset: "turns any classifier".length });
  });

  it("resolves through a markedContent wrapper", () => {
    const container = document.createElement("div");
    const wrapper = document.createElement("span");
    wrapper.className = "markedContent";
    const span = document.createElement("span");
    span.textContent = "eps";
    wrapper.append(span);
    container.append(wrapper);
    const index: DivIndex = { divs: [span], indexOfDiv: new WeakMap([[span, 0]]) };
    expect(resolveNode(index, span.firstChild, 2)).toEqual({ itemId: 0, offset: 2 });
  });

  it("returns null for a position outside the text layer", () => {
    const { index } = buildLayer(items);
    const stray = document.createElement("div");
    stray.textContent = "a drag that started on the canvas";
    expect(resolveNode(index, stray.firstChild, 3)).toBeNull();
    expect(resolveNode(index, null, 0)).toBeNull();
  });
});
