import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { openPdf } from "../pdf.js";
import { at, FILES, pagePng } from "../folder.js";
import { CliError, exists, writeAtomic } from "../util.js";

export interface RenderOptions {
  scale?: number;
  force?: boolean;
}

export interface RenderResult {
  written: number[];
  skipped: number[];
  scale: number;
}

/**
 * Render every page to `pages/pNNN.png`. These renders exist so the
 * `/lecture-terms` and `/lecture-notes` skills have eyes on the slide
 * (architecture.md §3); the app renders from the PDF itself.
 */
export async function renderPages(dir: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const scale = opts.scale ?? 1.5;
  if (!(scale > 0) || !Number.isFinite(scale)) throw new CliError(`--scale must be a positive number`);

  const deck = at(dir, FILES.deck);
  if (!(await exists(deck))) {
    throw new CliError(`no ${FILES.deck} in ${dir} — run \`lecture prepare\` first`);
  }
  await mkdir(path.join(dir, FILES.pages), { recursive: true });

  const { doc, close } = await openPdf(deck);
  const written: number[] = [];
  const skipped: number[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const out = pagePng(dir, n);
      if (!opts.force && (await exists(out))) {
        skipped.push(n);
        continue;
      }
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      // @napi-rs/canvas is API-compatible with the DOM canvas for everything
      // pdf.js touches, but it is not the DOM type pdf.js declares, so the
      // render parameters are cast rather than widened.
      const params = { canvas, canvasContext: ctx, viewport, background: "#ffffff" };
      await page.render(params as unknown as Parameters<typeof page.render>[0]).promise;
      await writeAtomic(out, await canvas.encode("png"));
      page.cleanup();
      written.push(n);
    }
  } finally {
    await close();
  }

  return { written, skipped, scale };
}
