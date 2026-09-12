import type { PDFPageProxy, PageViewport } from "./pdfjs.ts";

/** Cap the backing store so a retina screen does not allocate a huge canvas. */
const MAX_PIXEL_RATIO = 2;

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  viewport: PageViewport;
  /** CSS pixels per PDF user unit — what `--total-scale-factor` must be. */
  scale: number;
}

/**
 * Draw one page onto a canvas at `scale` CSS pixels per user unit.
 *
 * The dimmer is a CSS filter on the canvas element, never a redraw: the
 * professor's slide is dimmed, never restyled or inverted (ui-direction.md §A,
 * anti-pattern 3). Overlays sit above the filtered canvas.
 */
export async function renderPage(
  page: PDFPageProxy,
  canvas: HTMLCanvasElement,
  scale: number,
  dimmer?: number,
): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale });
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  canvas.width = Math.round(viewport.width * ratio);
  canvas.height = Math.round(viewport.height * ratio);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  if (dimmer !== undefined) {
    canvas.style.filter = `brightness(${dimmer}) contrast(1.03)`;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("this browser gave no 2d canvas context");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, viewport.width, viewport.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { canvas, viewport, scale };
}

/**
 * The largest scale at which the page still fits the available box. The slide
 * box absorbs spare height; the aspect ratio always comes from the page.
 */
export function fitScale(
  pageWidth: number,
  pageHeight: number,
  boxWidth: number,
  boxHeight: number,
): number {
  if (pageWidth <= 0 || pageHeight <= 0) return 1;
  return Math.max(0.05, Math.min(boxWidth / pageWidth, boxHeight / pageHeight));
}
