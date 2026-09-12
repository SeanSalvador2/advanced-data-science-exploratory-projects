import {
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  version as pdfjsVersion,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
} from "pdfjs-dist";

import { PDFJS_VERSION } from "@lecture/core";

import { hasGetOrInsert } from "./getOrInsert.ts";

export { TextLayer };
export type { PDFDocumentProxy, PDFPageProxy, PageViewport };

/**
 * The extraction options are fixed by architecture.md §4.2 and must match
 * `cli/src/pdf.ts` exactly: the span id is the index into the string-bearing
 * text items, and that index only agrees between Node and the browser when
 * both sides ask for text the same way.
 */
export const TEXT_CONTENT_OPTIONS = {
  includeMarkedContent: false,
  disableNormalization: false,
} as const;

let workerReady = false;

/**
 * The modern (non-legacy) build, with the worker as a module `Worker`.
 * `workerPort` rather than `workerSrc` so Vite owns the worker URL in both dev
 * and build, and there is no second copy of pdf.js on the page.
 */
function ensureWorker(): void {
  if (workerReady) return;
  // Both `new Worker(new URL(...))` expressions are written out in full:
  // that syntactic shape is what makes Vite emit the worker as a chunk rather
  // than copy the argument through as an opaque asset.
  const worker = hasGetOrInsert()
    ? new Worker(new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url), {
        type: "module",
      })
    : // The same worker with the `getOrInsert` shim imported ahead of it; see
      // `getOrInsert.ts`. Dead on current Chrome.
      new Worker(new URL("./worker-shim.ts", import.meta.url), { type: "module" });
  GlobalWorkerOptions.workerPort = worker;
  workerReady = true;
  if (pdfjsVersion !== PDFJS_VERSION) {
    console.warn(
      `pdf.js is ${pdfjsVersion} but this project is pinned to ${PDFJS_VERSION}; span ids may drift`,
    );
  }
}

/** Open a deck from bytes already read through the storage adapter. */
export async function loadDocument(bytes: ArrayBuffer): Promise<PDFDocumentProxy> {
  ensureWorker();
  // pdf.js transfers and detaches the buffer it is handed, so give it a copy;
  // the caller may want to keep the original (a re-open, a hash check).
  const task = getDocument({ data: new Uint8Array(bytes.slice(0)) });
  return task.promise;
}

export { pdfjsVersion };
