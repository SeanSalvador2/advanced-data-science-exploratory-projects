/**
 * The pdf.js worker, preceded by the `getOrInsert` shim.
 *
 * Only used on an engine that lacks those methods; `pdfjs.ts` hands the real
 * `pdfjs-dist/build/pdf.worker.mjs` URL to `new Worker` everywhere else. A
 * module worker is its own realm, so the shim cannot be installed into it from
 * the outside — it has to be the worker's first import.
 */
import "./getOrInsert.ts";
import "pdfjs-dist/build/pdf.worker.mjs";
