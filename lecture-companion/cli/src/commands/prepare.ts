import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { LectureManifest, SpanIndex } from "@lecture/core";
import { PDFJS_INSTALLED_VERSION, openPdf } from "../pdf.js";
import { at, FILES, writeManifest } from "../folder.js";
import { CliError, exists, median, nowIso, sha256 } from "../util.js";
import { extractSpans } from "./extract-spans.js";
import { renderPages } from "./render-pages.js";

export interface PrepareOptions {
  deck: string;
  course: string;
  id?: string;
  date?: string;
  title?: string;
  number?: number;
  scale?: number;
  prior?: string[];
  force?: boolean;
}

export interface PrepareResult {
  dir: string;
  manifest: LectureManifest;
  index: SpanIndex;
  rendered: number;
  skipped: number;
  summary: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Today in the local timezone, as YYYY-MM-DD. */
function today(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Create a lecture folder from a deck: copy the PDF, write the manifest, build
 * the span index, render the pages. Everything downstream reads this folder and
 * nothing else (architecture.md §3).
 */
export async function prepare(dir: string, opts: PrepareOptions): Promise<PrepareResult> {
  const lectureId = opts.id ?? path.basename(path.resolve(dir));
  if (lectureId === "") throw new CliError("cannot derive a lecture id from an empty folder name");
  const date = opts.date ?? today();
  if (!DATE_RE.test(date)) throw new CliError(`--date must be YYYY-MM-DD, got "${date}"`);
  if (!(await exists(opts.deck))) throw new CliError(`no such deck: ${opts.deck}`);

  await mkdir(dir, { recursive: true });

  const sourceBytes = new Uint8Array(await readFile(opts.deck));
  const deckSha = sha256(sourceBytes);
  const deckPath = at(dir, FILES.deck);

  if (await exists(deckPath)) {
    const existing = sha256(new Uint8Array(await readFile(deckPath)));
    if (existing !== deckSha && !opts.force) {
      throw new CliError(
        `${deckPath} already exists with a different sha256\n` +
          `  existing ${existing}\n  incoming ${deckSha}\n` +
          `re-run with --force to replace it (spans.json and pages/ will be rebuilt)`,
      );
    }
  }
  await copyFile(opts.deck, deckPath);

  const { doc, close } = await openPdf(deckPath);
  const pages = doc.numPages;
  await close();

  const manifest: LectureManifest = {
    schema: "lecture/1",
    lectureId,
    course: opts.course,
    ...(opts.number === undefined ? {} : { number: opts.number }),
    ...(opts.title === undefined ? {} : { title: opts.title }),
    date,
    deck: { file: "deck.pdf", sha256: deckSha, pages },
    pdfjs: {
      version: PDFJS_INSTALLED_VERSION as LectureManifest["pdfjs"]["version"],
      includeMarkedContent: false,
      disableNormalization: false,
    },
    status: {},
    ...(opts.prior && opts.prior.length > 0 ? { priorLectures: opts.prior } : {}),
  };
  await writeManifest(dir, manifest);

  const { index } = await extractSpans(dir);
  const render = await renderPages(dir, {
    ...(opts.scale === undefined ? {} : { scale: opts.scale }),
    ...(opts.force === undefined ? {} : { force: opts.force }),
  });

  manifest.status.prepared = nowIso();
  await writeManifest(dir, manifest);

  return {
    dir,
    manifest,
    index,
    rendered: render.written.length,
    skipped: render.skipped.length,
    summary: summarize(index),
  };
}

/** "6 pages, 214 items, lines per page min 3 / median 7 / max 12" */
export function summarize(index: SpanIndex): string {
  const items = index.pages.reduce((n, p) => n + p.items.length, 0);
  const perPage = index.pages.map((p) => p.lines.length).sort((a, b) => a - b);
  const min = perPage[0] ?? 0;
  const max = perPage[perPage.length - 1] ?? 0;
  return (
    `${index.pages.length} pages, ${items} items, ` +
    `lines per page min ${min} / median ${median(perPage)} / max ${max}`
  );
}
