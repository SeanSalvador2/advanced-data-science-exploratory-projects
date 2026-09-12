import type { LookupSelection } from "@lecture/core";

import { resolveNode, type DivIndex, type SpanPosition } from "../pdf/resolve.ts";

/**
 * `selectionchange` to `{page, beginItem, beginOffset, endItem, endOffset}`.
 *
 * `selectionchange` is the only event that covers every way a selection is
 * made: keyboard selection never fires `mouseup`, and a double click fires it
 * before the selection settles (phase-2-research.md §4). It is debounced
 * because a drag fires it per pixel.
 *
 * Four shapes have to survive the trip. A `<br>` endpoint — pdf.js inserts one
 * after every end-of-line item — and a double click that lands on the span
 * element are both handled by `resolveNode`. A backwards selection is sorted
 * here, by span id and then offset. A drag that began on the canvas or the
 * page container leaves an endpoint outside the text layer, and the last
 * pointer position plus `caretPositionFromPoint` is the way back in.
 */

/** The parts of a DOM `Selection` this needs; a real one satisfies it. */
export interface SelectionLike {
  readonly anchorNode: Node | null;
  readonly anchorOffset: number;
  readonly focusNode: Node | null;
  readonly focusOffset: number;
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  toString(): string;
}

/** `document`, as far as the caret fallback is concerned. */
export interface CaretSource {
  caretPositionFromPoint?(x: number, y: number): { offsetNode: Node | null; offset: number } | null;
  caretRangeFromPoint?(x: number, y: number): { startContainer: Node; startOffset: number } | null;
}

export interface Point {
  x: number;
  y: number;
}

export interface ReadSelectionArgs {
  index: DivIndex;
  page: number;
  selection: SelectionLike | null;
  /** The last place the pointer was, for a selection that began off the text. */
  point?: Point | null;
  caret?: CaretSource | null;
}

/** `a` before `b` in span order. */
function before(a: SpanPosition, b: SpanPosition): boolean {
  return a.itemId === b.itemId ? a.offset <= b.offset : a.itemId < b.itemId;
}

/**
 * Resolve one selection. Returns null when there is nothing to look up: no
 * selection, a collapsed one, or one that never touched the text layer.
 */
export function readSelection({
  index,
  page,
  selection,
  point,
  caret,
}: ReadSelectionArgs): LookupSelection | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const text = selection.toString();
  if (text.trim() === "") return null;

  let anchor = resolveNode(index, selection.anchorNode, selection.anchorOffset);
  let focus = resolveNode(index, selection.focusNode, selection.focusOffset);

  // One end started on the canvas or the page container. Ask the document
  // which caret is nearest the last pointer position and resolve that node.
  if (!anchor || !focus) {
    const fallback = fromPoint(index, caret, point);
    anchor = anchor ?? fallback;
    focus = focus ?? fallback;
  }
  if (!anchor || !focus) return null;

  const [begin, end] = before(anchor, focus) ? [anchor, focus] : [focus, anchor];
  return {
    page,
    beginItem: begin.itemId,
    beginOffset: begin.offset,
    endItem: end.itemId,
    endOffset: end.offset,
    text,
  };
}

function fromPoint(
  index: DivIndex,
  caret: CaretSource | null | undefined,
  point: Point | null | undefined,
): SpanPosition | null {
  if (!caret || !point) return null;
  if (typeof caret.caretPositionFromPoint === "function") {
    const pos = caret.caretPositionFromPoint(point.x, point.y);
    const resolved = pos ? resolveNode(index, pos.offsetNode, pos.offset) : null;
    if (resolved) return resolved;
  }
  if (typeof caret.caretRangeFromPoint === "function") {
    const range = caret.caretRangeFromPoint(point.x, point.y);
    const resolved = range ? resolveNode(index, range.startContainer, range.startOffset) : null;
    if (resolved) return resolved;
  }
  return null;
}

export interface SelectionWatcherOptions {
  /** The live text layer, or null while a page is rendering. */
  index: () => DivIndex | null;
  /** The page the text layer is currently showing. */
  page: () => number;
  onChange: (selection: LookupSelection | null) => void;
  /** A drag fires `selectionchange` per pixel; 120 ms is one settle. */
  debounceMs?: number;
  document?: Document;
}

const DEBOUNCE_MS = 120;

export class SelectionWatcher {
  #options: SelectionWatcherOptions;
  #doc: Document;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #point: Point | null = null;
  #current: LookupSelection | null = null;
  #bound = false;

  constructor(options: SelectionWatcherOptions) {
    this.#options = options;
    this.#doc = options.document ?? document;
  }

  /** The last selection that resolved, held until the selection collapses. */
  get current(): LookupSelection | null {
    return this.#current;
  }

  start(): void {
    if (this.#bound) return;
    this.#bound = true;
    this.#doc.addEventListener("selectionchange", this.#onSelectionChange);
    this.#doc.addEventListener("pointerdown", this.#onPointer, true);
    this.#doc.addEventListener("pointerup", this.#onPointer, true);
    this.#doc.addEventListener("pointermove", this.#onPointer, true);
  }

  stop(): void {
    if (!this.#bound) return;
    this.#bound = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#doc.removeEventListener("selectionchange", this.#onSelectionChange);
    this.#doc.removeEventListener("pointerdown", this.#onPointer, true);
    this.#doc.removeEventListener("pointerup", this.#onPointer, true);
    this.#doc.removeEventListener("pointermove", this.#onPointer, true);
  }

  /** Forget the selection without waiting for the DOM, e.g. on a page change. */
  clear(): void {
    if (this.#current === null) return;
    this.#current = null;
    this.#options.onChange(null);
  }

  /** Read the document now, skipping the debounce. */
  read(): LookupSelection | null {
    const index = this.#options.index();
    if (!index) return this.#current;
    const next = readSelection({
      index,
      page: this.#options.page(),
      selection: this.#doc.getSelection(),
      point: this.#point,
      caret: this.#doc as CaretSource,
    });
    if (next === null && this.#current === null) return null;
    this.#current = next;
    this.#options.onChange(next);
    return next;
  }

  #onPointer = (ev: Event): void => {
    const pointer = ev as PointerEvent;
    if (typeof pointer.clientX !== "number") return;
    this.#point = { x: pointer.clientX, y: pointer.clientY };
  };

  #onSelectionChange = (): void => {
    if (this.#timer !== null) clearTimeout(this.#timer);
    const wait = this.#options.debounceMs ?? DEBOUNCE_MS;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.read();
    }, wait);
  };
}
