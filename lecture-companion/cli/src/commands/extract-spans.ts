import { readFile } from "node:fs/promises";
import {
  groupLines,
  itemBoxFromTransform,
  type SpanIndex,
  type SpanItem,
  type SpanPage,
  type Transform,
} from "@lecture/core";
import { openPdf, PDFJS_INSTALLED_VERSION } from "../pdf.js";
import { at, FILES } from "../folder.js";
import { CliError, canonicalJson, exists, round3, sha256, writeAtomic } from "../util.js";

/**
 * pdf.js names fonts `g_d<documentOrdinal>_f<fontIndex>`, where the document
 * ordinal counts loading tasks in the current process. It says nothing about
 * the PDF, so it is pinned to 0: without this, extracting the same deck twice
 * in one process yields different `font` strings and `spans.json` stops being
 * reproducible. The font index, which does distinguish the page's fonts, is
 * kept.
 */
export function normalizeFontId(fontName: string): string {
  return fontName.replace(/^g_d\d+_/, "g_d0_");
}

/**
 * Build the span index for a deck.
 *
 * Span ids are indexes into pdf.js's string-bearing text items for the page,
 * *empty strings included* (architecture.md §4.2): that is the same index the
 * pdf.js text layer uses for `textDivs` and the same index Obsidian selection
 * links use, so it must not be compacted. Extraction options are fixed at
 * `includeMarkedContent: false` / `disableNormalization: false` on both the
 * Node and the browser side so the ids agree.
 */
export async function buildSpanIndex(pdfFile: string): Promise<SpanIndex> {
  const { doc, bytes, close } = await openPdf(pdfFile);
  const pages: SpanPage[] = [];

  try {
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent({
        includeMarkedContent: false,
        disableNormalization: false,
      });

      const items: SpanItem[] = [];
      for (const raw of content.items) {
        // With includeMarkedContent false every entry is a TextItem, but the
        // published type is a union, so narrow on the property that defines it.
        if (!("str" in raw)) continue;
        const transform = raw.transform as Transform;
        const box = itemBoxFromTransform(transform, raw.width, raw.height, viewport);
        items.push({
          id: items.length,
          str: raw.str,
          box: [round3(box[0]), round3(box[1]), round3(box[2]), round3(box[3])],
          transform: [
            round3(transform[0]),
            round3(transform[1]),
            round3(transform[2]),
            round3(transform[3]),
            round3(transform[4]),
            round3(transform[5]),
          ],
          font: normalizeFontId(raw.fontName),
          eol: raw.hasEOL,
        });
      }

      pages.push({
        page: n,
        width: round3(viewport.width),
        height: round3(viewport.height),
        items,
        lines: groupLines(items),
      });
      page.cleanup();
    }
  } finally {
    await close();
  }

  return {
    schema: "spans/1",
    pdfjsVersion: PDFJS_INSTALLED_VERSION as SpanIndex["pdfjsVersion"],
    extractOptions: { includeMarkedContent: false, disableNormalization: false },
    deckSha256: sha256(bytes),
    pages,
  };
}

export interface ExtractResult {
  index: SpanIndex;
  file: string;
}

export async function extractSpans(dir: string): Promise<ExtractResult> {
  const deck = at(dir, FILES.deck);
  if (!(await exists(deck))) {
    throw new CliError(`no ${FILES.deck} in ${dir} — run \`lecture prepare\` first`);
  }
  const index = await buildSpanIndex(deck);
  const file = at(dir, FILES.spans);
  await writeAtomic(file, canonicalJson(index));
  return { index, file };
}

export async function readSpanIndex(dir: string): Promise<SpanIndex> {
  const file = at(dir, FILES.spans);
  if (!(await exists(file))) {
    throw new CliError(`no ${FILES.spans} in ${dir} — run \`lecture extract-spans\` first`);
  }
  return JSON.parse(await readFile(file, "utf8")) as SpanIndex;
}
