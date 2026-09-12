import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  TermIndexSchema,
  formatIssues,
  toIssues,
  type SpanLineKind,
  type TermIndex,
} from "@lecture/core";
import { FILES, readManifest } from "../folder.js";
import { CliError, exists } from "../util.js";
import { readSpanIndex } from "./extract-spans.js";

/** A prior lecture's glossary entry, compacted for the prompt (architecture.md §5). */
export interface PriorGlossaryEntry {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
}

export interface TermsContextLine {
  id: number;
  text: string;
  kind?: SpanLineKind;
}

export interface TermsContextPage {
  page: number;
  lines: TermsContextLine[];
}

/** Everything `/lecture-terms` needs for one batch except the page images. */
export interface TermsContext {
  lectureId: string;
  course: string;
  priorGlossary: PriorGlossaryEntry[];
  pages: TermsContextPage[];
}

export interface TermsContextResult {
  context: TermsContext;
  /** Non-fatal notes for stderr: clamped ranges, prior lectures not found. */
  warnings: string[];
  from: number;
  to: number;
}

/** A prior definition is context, not content: one line of it is enough. */
export const PRIOR_DEFINITION_MAX = 160;

export interface PageRange {
  from: number;
  to: number;
  warnings: string[];
}

/**
 * Parse `--pages a-b` (or a single `a`) against a deck of `total` pages. The
 * upper bound is clamped rather than rejected so a skill can walk the deck in
 * fixed strides of eight without special-casing the last batch.
 */
export function parsePageRange(spec: string, total: number): PageRange {
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(spec);
  if (m === null) throw new CliError(`--pages must look like "1-8" or "3", got "${spec}"`);
  const from = Number.parseInt(m[1] as string, 10);
  const to = m[2] === undefined ? from : Number.parseInt(m[2] as string, 10);
  if (from < 1) throw new CliError(`--pages starts at page 1, got "${spec}"`);
  if (to < from) throw new CliError(`--pages range runs backwards: "${spec}"`);
  if (from > total) {
    throw new CliError(`--pages ${spec} starts past the end of the deck (${total} pages)`);
  }
  const warnings: string[] = [];
  if (to > total) warnings.push(`--pages ${spec} clamped to ${from}-${total} (the deck has ${total} pages)`);
  return { from, to: Math.min(to, total), warnings };
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/**
 * The glossaries of the prior lectures named in `lecture.json`, oldest first,
 * one entry per id. A prior lecture that has not been prepared yet, or has no
 * term index yet, is a warning: the current lecture can still be indexed, just
 * with less consistency to lean on.
 */
export async function readPriorGlossary(
  dir: string,
  priorLectures: string[],
): Promise<{ entries: PriorGlossaryEntry[]; warnings: string[] }> {
  const parent = path.dirname(path.resolve(dir));
  const warnings: string[] = [];
  const seen = new Set<string>();
  const entries: PriorGlossaryEntry[] = [];

  for (const lectureId of priorLectures) {
    const file = path.join(parent, lectureId, FILES.terms);
    if (!(await exists(file))) {
      warnings.push(`prior lecture ${lectureId}: no ${file}, skipped`);
      continue;
    }
    let index: TermIndex;
    try {
      const parsed = TermIndexSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
      if (!parsed.success) {
        warnings.push(`prior lecture ${lectureId}: ${file} is not a valid TermIndex, skipped\n${formatIssues(toIssues(parsed.error))}`);
        continue;
      }
      index = parsed.data;
    } catch (err) {
      warnings.push(`prior lecture ${lectureId}: could not read ${file} (${(err as Error).message}), skipped`);
      continue;
    }
    for (const entry of index.glossary) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push({
        id: entry.id,
        term: entry.term,
        aliases: [...entry.aliases],
        definition: truncate(entry.definition, PRIOR_DEFINITION_MAX),
      });
    }
  }
  return { entries, warnings };
}

/**
 * Assemble the text half of the `/lecture-terms` prompt for one batch of
 * pages. The other half is the page images, which the skill reads itself.
 *
 * Lines that are empty once trimmed are dropped: they are text items the PDF
 * kept for spacing, they cost context, and no term can sit on them.
 */
export async function termsContext(dir: string, pagesSpec: string): Promise<TermsContextResult> {
  const manifest = await readManifest(dir);
  const range = parsePageRange(pagesSpec, manifest.deck.pages);
  const spans = await readSpanIndex(dir);

  const byPage = new Map(spans.pages.map((p) => [p.page, p]));
  const warnings = [...range.warnings];
  const pages: TermsContextPage[] = [];
  for (let n = range.from; n <= range.to; n += 1) {
    const span = byPage.get(n);
    if (span === undefined) {
      warnings.push(`page ${n} is missing from ${FILES.spans}`);
      pages.push({ page: n, lines: [] });
      continue;
    }
    const lines: TermsContextLine[] = [];
    for (const line of span.lines) {
      const text = line.text.trim();
      if (text === "") continue;
      lines.push({ id: line.id, text, ...(line.kind === undefined ? {} : { kind: line.kind }) });
    }
    pages.push({ page: n, lines });
  }

  const prior = await readPriorGlossary(dir, manifest.priorLectures ?? []);
  warnings.push(...prior.warnings);

  return {
    context: {
      lectureId: manifest.lectureId,
      course: manifest.course,
      priorGlossary: prior.entries,
      pages,
    },
    warnings,
    from: range.from,
    to: range.to,
  };
}
