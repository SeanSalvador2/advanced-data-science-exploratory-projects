import type { SpanIndex } from "@lecture/core";

import { TEXT_CONTENT_OPTIONS, TextLayer, type PDFPageProxy, type PageViewport } from "./pdfjs.ts";
import { resolveNode, type DivIndex, type SpanPosition } from "./resolve.ts";

/**
 * A transparent, selectable pdf.js text layer positioned over the canvas, plus
 * the span-id map that highlight-to-explain and review mode read.
 *
 * The map is built from `textLayer.textDivs`, never from the container's DOM
 * children: `textDivs[i]` is the i-th string-bearing text item including the
 * empty ones, which is exactly the span id in `spans.json`, while only the
 * non-empty items are appended to the DOM and `<br>` elements are interleaved
 * (phase-2-research.md §4 and the pdf.js `TextLayer#appendText` source).
 */
export class TextLayerHost implements DivIndex {
  readonly container: HTMLDivElement;

  indexOfDiv: WeakMap<HTMLElement, number> = new WeakMap();
  divs: HTMLElement[] = [];
  /** `textContentItemsStr[i]` for each span id; parallel to `divs`. */
  itemsStr: string[] = [];

  #layer: TextLayer | null = null;

  constructor() {
    this.container = document.createElement("div");
    this.container.className = "textLayer";
  }

  /** Replace the layer's contents with `page` rendered at `viewport`. */
  async render(page: PDFPageProxy, viewport: PageViewport): Promise<void> {
    this.cancel();
    this.container.textContent = "";
    this.container.style.setProperty("--total-scale-factor", String(viewport.scale));
    this.container.style.setProperty("--scale-round-x", "1px");
    this.container.style.setProperty("--scale-round-y", "1px");

    const textContentSource = await page.getTextContent(TEXT_CONTENT_OPTIONS);
    const layer = new TextLayer({
      textContentSource,
      container: this.container,
      viewport,
    });
    this.#layer = layer;
    await layer.render();

    this.divs = layer.textDivs as HTMLElement[];
    this.itemsStr = layer.textContentItemsStr;
    const map = new WeakMap<HTMLElement, number>();
    this.divs.forEach((div, i) => map.set(div, i));
    this.indexOfDiv = map;
  }

  /** Re-lay the existing divs after a resize, without re-reading the text. */
  update(viewport: PageViewport): void {
    this.container.style.setProperty("--total-scale-factor", String(viewport.scale));
    this.#layer?.update({ viewport });
  }

  cancel(): void {
    if (!this.#layer) return;
    try {
      this.#layer.cancel();
    } catch {
      // `cancel` rejects the layer's own promise; nothing else to do.
    }
    this.#layer = null;
  }

  destroy(): void {
    this.cancel();
    this.container.remove();
  }

  /** See `resolveNode`; `SelectionWatcher` maps a selection through this. */
  resolveNode(node: Node | null, offset: number): SpanPosition | null {
    return resolveNode(this, node, offset);
  }

  /**
   * Dev-only: the count of string-bearing items the browser saw must equal the
   * count the Node CLI wrote into `spans.json`, or the span ids the export and
   * the term index use do not address what the app is showing.
   */
  checkAgainstSpans(spans: SpanIndex | null, pageNumber: number): void {
    if (!import.meta.env.DEV || !spans) return;
    const page = spans.pages.find((p) => p.page === pageNumber);
    if (!page) return;
    if (page.items.length !== this.itemsStr.length) {
      console.warn(
        `span id mismatch on page ${pageNumber}: spans.json has ${page.items.length} items, ` +
          `the text layer built ${this.itemsStr.length}. Re-run \`lecture prepare\`.`,
      );
    }
  }
}
