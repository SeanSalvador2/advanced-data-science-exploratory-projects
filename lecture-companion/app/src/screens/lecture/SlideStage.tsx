import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { SpanIndex } from "@lecture/core";

import { fitScale, renderPage } from "../../pdf/render.ts";
import { TextLayerHost } from "../../pdf/TextLayerHost.ts";
import type { PDFDocumentProxy, PDFPageProxy } from "../../pdf/pdfjs.ts";

import styles from "./SlideStage.module.css";

/** How far ahead and behind to keep rendered canvases warm. */
const PRELOAD = [1, -1, 2, -2];
const CACHE_LIMIT = 7;

export interface SlideStageProps {
  doc: PDFDocumentProxy;
  pageNumber: number;
  /** `--dim`: brightness reduction on the canvas only, never inversion. */
  dim: number;
  spans: SpanIndex | null;
  onTextLayer?: (host: TextLayerHost) => void;
}

function idle(fn: () => void): void {
  const ric = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (typeof ric === "function") ric(fn);
  else setTimeout(fn, 50);
}

/**
 * The slide: a pdf.js canvas with a transparent, selectable text layer over
 * it, centred in whatever box is left after the padding and the status strip.
 *
 * Rendering is imperative because pdf.js owns the canvas and the text layer's
 * DOM; React owns only the box. Canvases for the pages either side are
 * rendered off-screen and cached, so an arrow key is a `replaceChild` rather
 * than a decode.
 */
export function SlideStage({
  doc,
  pageNumber,
  dim,
  spans,
  onTextLayer,
}: SlideStageProps): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const canvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const pageCache = useRef<Map<number, PDFPageProxy>>(new Map());
  const textLayer = useRef<TextLayerHost | null>(null);
  const generation = useRef(0);
  const [box, setBox] = useState({ width: 0, height: 0 });
  // Read through a ref: a dim change must not re-render the page, only refilter.
  const dimRef = useRef(dim);
  dimRef.current = dim;

  // Measure the available box. The slide absorbs every spare pixel of it.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const rect = entry.contentRect;
      setBox({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    });
    observer.observe(el);
    const rect = el.getBoundingClientRect();
    setBox({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!textLayer.current) {
      textLayer.current = new TextLayerHost();
      onTextLayer?.(textLayer.current);
    }
  }, [onTextLayer]);

  useEffect(() => {
    if (box.width === 0 || box.height === 0) return;
    const token = (generation.current += 1);
    let cancelled = false;

    const getPage = async (n: number): Promise<PDFPageProxy> => {
      const cached = pageCache.current.get(n);
      if (cached) return cached;
      const page = await doc.getPage(n);
      pageCache.current.set(n, page);
      return page;
    };

    const canvasFor = async (n: number, scale: number): Promise<HTMLCanvasElement> => {
      const key = `${n}@${scale.toFixed(3)}`;
      const cached = canvasCache.current.get(key);
      if (cached) return cached;
      const page = await getPage(n);
      const canvas = document.createElement("canvas");
      canvas.className = styles["canvas"] as string;
      await renderPage(page, canvas, scale, dimRef.current);
      canvasCache.current.set(key, canvas);
      // Keep the map small: the two pages either side plus a little slack.
      while (canvasCache.current.size > CACHE_LIMIT) {
        const oldest = canvasCache.current.keys().next().value;
        if (oldest === undefined) break;
        canvasCache.current.delete(oldest);
      }
      return canvas;
    };

    void (async () => {
      const page = await getPage(pageNumber);
      if (cancelled || token !== generation.current) return;
      const base = page.getViewport({ scale: 1 });
      const scale = fitScale(base.width, base.height, box.width, box.height);
      const viewport = page.getViewport({ scale });

      const slide = slideRef.current;
      if (!slide) return;
      slide.style.width = `${viewport.width}px`;
      slide.style.height = `${viewport.height}px`;

      const canvas = await canvasFor(pageNumber, scale);
      if (cancelled || token !== generation.current) return;
      canvas.style.filter = `brightness(${dimRef.current}) contrast(1.03)`;

      const host = textLayer.current;
      const previous = slide.querySelector("canvas");
      if (previous && previous !== canvas) previous.remove();
      if (canvas.parentElement !== slide) slide.insertBefore(canvas, slide.firstChild);

      if (host) {
        await host.render(page, viewport);
        if (cancelled || token !== generation.current) return;
        host.checkAgainstSpans(spans, pageNumber);
        host.container.dataset["testid"] = "text-layer";
        host.container.dataset["itemCount"] = String(host.divs.length);
        host.container.dataset["page"] = String(pageNumber);
        if (host.container.parentElement !== slide) slide.append(host.container);
      }
      slide.dataset["page"] = String(pageNumber);
      slide.dataset["ready"] = "yes";

      // Warm the neighbours once the current page is on screen.
      idle(() => {
        if (cancelled || token !== generation.current) return;
        void (async () => {
          for (const offset of PRELOAD) {
            const n = pageNumber + offset;
            if (n < 1 || n > doc.numPages) continue;
            if (cancelled || token !== generation.current) return;
            await canvasFor(n, scale).catch(() => undefined);
          }
        })();
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, box.width, box.height, spans]);

  // A dim change must reach the canvas already on screen, not only new ones.
  useEffect(() => {
    const canvas = slideRef.current?.querySelector("canvas");
    if (canvas) canvas.style.filter = `brightness(${dim}) contrast(1.03)`;
  }, [dim]);

  useEffect(
    () => () => {
      textLayer.current?.destroy();
      textLayer.current = null;
      generation.current += 1;
    },
    [],
  );

  return (
    <div className={styles["box"]} ref={boxRef}>
      <div className={styles["slide"]} ref={slideRef} data-testid="slide" />
    </div>
  );
}
