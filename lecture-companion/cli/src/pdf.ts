import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

/** Absolute path of the installed `pdfjs-dist` package root. */
export const PDFJS_ROOT = path.dirname(require.resolve("pdfjs-dist/package.json"));

/**
 * The version of the `pdfjs-dist` actually installed, read from its own
 * package.json. Stamped into `spans.json` and `lecture.json` so that a drifting
 * dependency is visible in the artefacts (architecture.md §11).
 */
export const PDFJS_INSTALLED_VERSION: string = (
  require("pdfjs-dist/package.json") as { version: string }
).version;

/**
 * Filesystem paths, with a trailing separator, not `file://` URLs: in Node
 * pdf.js resolves these two by handing the string straight to
 * `fs.readFile`, so a URL string is read as a relative path and every
 * non-embedded font silently falls back ("Unable to load font data at ...").
 */
const STANDARD_FONT_DATA_URL = `${path.join(PDFJS_ROOT, "standard_fonts")}${path.sep}`;
const CMAP_URL = `${path.join(PDFJS_ROOT, "cmaps")}${path.sep}`;

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let cached: PdfjsModule | null = null;

/**
 * Load the *legacy* build. The modern build uses `Promise.try`, which Node 22
 * does not have, so it throws on import (phase-2-research.md §4, and verified
 * here).
 */
export async function loadPdfjs(): Promise<PdfjsModule> {
  if (cached) return cached;
  const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfjsModule;
  // No worker thread in Node: pdf.js falls back to running in-process, which is
  // what we want for a deterministic, single-shot CLI.
  mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(PDFJS_ROOT, "legacy", "build", "pdf.worker.mjs"),
  ).href;
  cached = mod;
  return mod;
}

type LoadingTask = ReturnType<PdfjsModule["getDocument"]>;

export interface OpenedPdf {
  doc: Awaited<LoadingTask["promise"]>;
  bytes: Uint8Array;
  /** Tear the worker down. `PDFDocumentProxy` has no public `destroy` in v6. */
  close: () => Promise<void>;
}

/**
 * Open a PDF from disk with the extraction settings fixed by
 * architecture.md §4.2. Bytes are handed over as a `Uint8Array`; pdf.js
 * transfers (and detaches) the buffer it is given, so a copy is passed.
 */
export async function openPdf(file: string): Promise<OpenedPdf> {
  const buf = await readFile(file);
  const bytes = new Uint8Array(buf);
  const { getDocument } = await loadPdfjs();
  const task = getDocument({
    data: new Uint8Array(bytes),
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    cMapUrl: CMAP_URL,
    cMapPacked: true,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  return { doc, bytes, close: () => task.destroy() };
}
