/**
 * Mapping a DOM position inside a pdf.js text layer back to a span id.
 *
 * The span id is the index into the text layer's `textDivs` array, which is
 * the index into the string-bearing text items, empty strings included
 * (architecture.md §4.2, phase-2-research.md §4). It is never the DOM child
 * index: pdf.js appends a div only when the item has text, and it appends
 * `<br>` elements for end-of-line items, so the two counts differ on almost
 * every page.
 *
 * This module is deliberately free of any pdf.js import so it can be unit
 * tested over a hand-built fragment in jsdom.
 */

export interface SpanPosition {
  /** Index into `textDivs`, i.e. the span id in `spans.json`. */
  itemId: number;
  /** Character offset inside that item's string. */
  offset: number;
}

export interface DivIndex {
  indexOfDiv: WeakMap<HTMLElement, number>;
  divs: HTMLElement[];
}

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === 1;
}

/** The nearest ancestor-or-self that carries a span id. */
function climb(index: DivIndex, node: Node | null): HTMLElement | null {
  let cur: Node | null = node;
  while (cur) {
    if (isElement(cur) && index.indexOfDiv.has(cur)) return cur;
    cur = cur.parentNode;
  }
  return null;
}

/**
 * Resolve `(node, offset)` — a `Range` endpoint — to `{ itemId, offset }`.
 *
 * Handles the three shapes a selection endpoint takes in a text layer: inside
 * a text node (the common case), on the span element itself (a double click),
 * and on the layer or a `markedContent` wrapper, where `offset` is a child
 * index and may land on a `<br>` that pdf.js inserted for an end-of-line item.
 * Returns null when the position is outside the text layer entirely, for
 * example a drag that started on the canvas.
 */
export function resolveNode(
  index: DivIndex,
  node: Node | null,
  offset: number,
): SpanPosition | null {
  if (!node) return null;

  // A text node, or anything nested inside a span.
  const owner = climb(index, node);
  if (owner) {
    const itemId = index.indexOfDiv.get(owner) as number;
    if (node === owner) {
      // Offset is a child index here, not a character offset.
      const text = owner.textContent ?? "";
      return { itemId, offset: offset <= 0 ? 0 : text.length };
    }
    const text = node.nodeType === 3 ? (node.nodeValue ?? "") : (node.textContent ?? "");
    return { itemId, offset: Math.max(0, Math.min(offset, text.length)) };
  }

  // On a container: pick the child the offset points at, or the one before it.
  if (isElement(node)) {
    const children = Array.from(node.childNodes);
    const at = children[Math.min(offset, children.length - 1)] ?? null;
    const forward = climb(index, at);
    if (forward) {
      const itemId = index.indexOfDiv.get(forward) as number;
      const atEnd = offset >= children.length;
      return { itemId, offset: atEnd ? (forward.textContent ?? "").length : 0 };
    }
    // A `<br>`, or something with no id: fall back to the previous sibling
    // that does have one, positioned at its end.
    for (let i = Math.min(offset, children.length) - 1; i >= 0; i -= 1) {
      const prev = climb(index, children[i] ?? null);
      if (prev) {
        const itemId = index.indexOfDiv.get(prev) as number;
        return { itemId, offset: (prev.textContent ?? "").length };
      }
    }
    // Or the next one, positioned at its start.
    for (let i = Math.min(offset, children.length); i < children.length; i += 1) {
      const next = climb(index, children[i] ?? null);
      if (next) return { itemId: index.indexOfDiv.get(next) as number, offset: 0 };
    }

    // A childless element, which in a text layer means the `<br>` pdf.js
    // inserts after an end-of-line item: take the span it follows.
    for (let sib = node.previousSibling; sib; sib = sib.previousSibling) {
      const prev = climb(index, sib);
      if (prev) {
        const itemId = index.indexOfDiv.get(prev) as number;
        return { itemId, offset: (prev.textContent ?? "").length };
      }
    }
    for (let sib = node.nextSibling; sib; sib = sib.nextSibling) {
      const next = climb(index, sib);
      if (next) return { itemId: index.indexOfDiv.get(next) as number, offset: 0 };
    }
  }

  return null;
}
