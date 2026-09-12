/**
 * The dark-deck switch (ui-direction.md §E).
 *
 * The highlight fills multiply onto the substrate because the substrate is
 * normally the professor's light PDF. A deck printed on black is the exception:
 * multiply against it is invisible, so on the first render of a lecture the
 * mean canvas luminance is sampled and anything below 0.5 flips that lecture to
 * `screen` blending and the on-dark fills.
 *
 * The sample is taken from the canvas bitmap, which is the undimmed page: the
 * dimmer is a CSS filter on the element and never touches the pixels.
 */

/** Below this, the deck is dark. */
export const DARK_DECK_THRESHOLD = 0.5;

/** How many pixels a side the offscreen sample canvas has. */
export const SAMPLE_SIZE = 32;

/**
 * Mean relative luminance of RGBA bytes, 0 (black) to 1 (white).
 *
 * Rec. 709 coefficients on the sRGB values as stored. Gamma is deliberately not
 * undone: the question is "does this page read as dark on screen", which is a
 * question about the encoded values, and undoing gamma would call a mid grey
 * page dark.
 */
export function meanLuminance(pixels: Uint8ClampedArray | Uint8Array): number {
  if (pixels.length < 4) return 1;
  let total = 0;
  let count = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] as number;
    const g = pixels[i + 1] as number;
    const b = pixels[i + 2] as number;
    total += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    count += 1;
  }
  return count === 0 ? 1 : total / count;
}

export function isDarkDeck(mean: number): boolean {
  return mean < DARK_DECK_THRESHOLD;
}

/**
 * Draw a rendered page down to a small offscreen canvas and average it.
 * Returns null when the canvas is not drawable yet or the browser refuses a 2d
 * context, which is a "not dark" answer, not an error.
 */
export function sampleCanvasLuminance(
  canvas: HTMLCanvasElement,
  size = SAMPLE_SIZE,
): number | null {
  if (canvas.width === 0 || canvas.height === 0) return null;
  const off = document.createElement("canvas");
  off.width = size;
  off.height = size;
  const ctx = off.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(canvas, 0, 0, size, size);
    return meanLuminance(ctx.getImageData(0, 0, size, size).data);
  } catch {
    // A tainted or zero-sized source. Treat the deck as light.
    return null;
  }
}

/** One answer per lecture, kept for the life of the tab. */
const cache = new Map<string, boolean>();

export function rememberDeck(lectureId: string, dark: boolean): void {
  cache.set(lectureId, dark);
}

export function rememberedDeck(lectureId: string): boolean | undefined {
  return cache.get(lectureId);
}

/** Test-only: the cache is process-wide and a test must not inherit it. */
export function forgetDecks(): void {
  cache.clear();
}
