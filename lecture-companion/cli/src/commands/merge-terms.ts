import { readFile, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import {
  MAX_PAGE_BIAS_TERMS,
  TermIndexSchema,
  TermPageSchema,
  buildTermIndex,
  formatIssues,
  mergeTermPages,
  toIssues,
  type MergeIssue,
  type SourcedTermPage,
  type TermIndex,
  type TermPage,
} from "@lecture/core";
import { at, FILES, readManifest, writeManifest } from "../folder.js";
import { CliError, canonicalJson, exists, median, nowIso, writeAtomic } from "../util.js";

/** Where `/lecture-terms` drops one file per batch (architecture.md §3, §5). */
export const PARTIAL_DIR = path.join(".lecture", "terms.partial");

export interface MergeTermsOptions {
  allowMissing?: boolean;
  clean?: boolean;
}

export interface CheckPartialsResult {
  /** Partial files read, in merge order. */
  sources: string[];
  /** Pages 1..N of the deck that no partial covers yet. */
  uncovered: number[];
  clamped: { page: number; from: number; source: string }[];
}

export interface MergeTermsResult {
  file: string;
  index: TermIndex;
  /** Partial files read, in the order they were merged. */
  sources: string[];
  filled: number[];
  clamped: { page: number; from: number; source: string }[];
  removed: string[];
}

export function partialDir(dir: string): string {
  return at(dir, PARTIAL_DIR);
}

/** `batch-01.json`, `batch-02.json`, ... in name order, which is batch order. */
async function listPartials(dir: string): Promise<string[]> {
  const root = partialDir(dir);
  if (!(await exists(root))) {
    throw new CliError(
      `no ${PARTIAL_DIR} in ${dir} — run the /lecture-terms skill first, it writes one JSON file per batch`,
    );
  }
  const names = (await readdir(root)).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) {
    throw new CliError(`${root} holds no .json files — nothing to merge`);
  }
  return names.map((n) => path.join(root, n));
}

/**
 * Read one partial file: `{ "pages": TermPage[] }`. Every failure names the
 * file and, where it can, the page, because the person fixing it is a model
 * re-running one batch, not a human reading a stack trace.
 */
export function readPartial(
  file: string,
  raw: unknown,
): { pages: SourcedTermPage[]; clamped: { page: number; from: number; source: string }[]; errors: string[] } {
  const name = path.basename(file);
  const errors: string[] = [];
  const pages: SourcedTermPage[] = [];
  const clamped: { page: number; from: number; source: string }[] = [];

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { pages, clamped, errors: [`${name}: expected a JSON object with a "pages" array`] };
  }
  const list = (raw as { pages?: unknown }).pages;
  if (!Array.isArray(list)) {
    return { pages, clamped, errors: [`${name}: expected a "pages" array, got ${describe(list)}`] };
  }

  list.forEach((entry, i) => {
    const where = pageLabel(entry, i);
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      errors.push(`${name} ${where}: expected an object`);
      return;
    }
    // Clamp before validating: `asrBias` over 40 is the model being generous,
    // not the file being broken, and the schema's own cap would reject it.
    const record = { ...(entry as Record<string, unknown>) };
    const bias = record["asrBias"];
    if (Array.isArray(bias) && bias.length > MAX_PAGE_BIAS_TERMS) {
      clamped.push({
        page: typeof record["page"] === "number" ? (record["page"] as number) : i,
        from: bias.length,
        source: name,
      });
      record["asrBias"] = bias.slice(0, MAX_PAGE_BIAS_TERMS);
    }
    const parsed = TermPageSchema.safeParse(record);
    if (!parsed.success) {
      errors.push(`${name} ${where}:\n${formatIssues(toIssues(parsed.error))}`);
      return;
    }
    pages.push({ source: name, page: parsed.data });
  });

  return { pages, clamped, errors };
}

function pageLabel(entry: unknown, i: number): string {
  const n = (entry as { page?: unknown } | null)?.page;
  return typeof n === "number" ? `page ${n}` : `pages[${i}]`;
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  return Array.isArray(value) ? "an array" : typeof value;
}

function renderIssue(issue: MergeIssue, dir: string, total: number): string {
  if (issue.kind === "duplicate") {
    return `page ${issue.page} appears in more than one partial: ${issue.sources.join(", ")}`;
  }
  if (issue.kind === "out-of-range") {
    return `page ${issue.page} is not in the deck (${total} pages): ${issue.sources.join(", ")}`;
  }
  return (
    `${issue.pages.length} page(s) missing from ${path.join(dir, PARTIAL_DIR)}: ${issue.pages.join(", ")}\n` +
    `  re-run those batches, or pass --allow-missing to fill them with empty pages`
  );
}

/**
 * Read and validate the partials without writing anything, so a skill can
 * check the batch it has just written without merging a deck it has not
 * finished. Pages still missing are listed, not refused: mid-run, that is the
 * normal state.
 */
export async function checkPartials(dir: string): Promise<CheckPartialsResult> {
  const manifest = await readManifest(dir);
  const { files, sourced, clamped } = await readAllPartials(dir);

  const merged = mergeTermPages(sourced, manifest.deck.pages, { allowMissing: true });
  const fatal = merged.issues.filter((i) => i.kind !== "missing");
  if (fatal.length > 0) {
    throw new CliError(fatal.map((i) => renderIssue(i, dir, manifest.deck.pages)).join("\n"));
  }
  const covered = new Set(sourced.map((s) => s.page.page));
  const uncovered: number[] = [];
  for (let n = 1; n <= manifest.deck.pages; n += 1) if (!covered.has(n)) uncovered.push(n);

  return { sources: files.map((f) => path.basename(f)), uncovered, clamped };
}

export function summarizeCheck(result: CheckPartialsResult): string {
  const lines = [
    `ok  ${result.sources.length} partial(s) validate: ${result.sources.join(", ")}`,
    `  pages not written yet: ${result.uncovered.length === 0 ? "none" : result.uncovered.join(", ")}`,
  ];
  for (const c of result.clamped) {
    lines.push(`  warning: ${c.source} page ${c.page} has ${c.from} asrBias terms; the merge keeps ${MAX_PAGE_BIAS_TERMS}`);
  }
  return lines.join("\n");
}

/** Read every partial in the folder, validating each page as it goes. */
async function readAllPartials(dir: string): Promise<{
  files: string[];
  sourced: SourcedTermPage[];
  clamped: { page: number; from: number; source: string }[];
}> {
  const files = await listPartials(dir);
  const sourced: SourcedTermPage[] = [];
  const clamped: { page: number; from: number; source: string }[] = [];
  const errors: string[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      errors.push(`${path.basename(file)}: not valid JSON — ${(err as Error).message}`);
      continue;
    }
    const read = readPartial(file, raw);
    sourced.push(...read.pages);
    clamped.push(...read.clamped);
    errors.push(...read.errors);
  }
  if (errors.length > 0) {
    throw new CliError(`${errors.length} problem(s) in ${path.join(dir, PARTIAL_DIR)}:\n${errors.join("\n")}`);
  }
  return { files, sourced, clamped };
}

/**
 * Merge every batch file into `terms.json` (architecture.md §5): validate each
 * page on its own, insist the deck is covered exactly once, build the
 * glossary, validate the whole document, then stamp the manifest.
 */
export async function mergeTerms(dir: string, opts: MergeTermsOptions = {}): Promise<MergeTermsResult> {
  const manifest = await readManifest(dir);
  const total = manifest.deck.pages;
  const { files, sourced, clamped } = await readAllPartials(dir);

  const merged = mergeTermPages(sourced, total, {
    ...(opts.allowMissing === undefined ? {} : { allowMissing: opts.allowMissing }),
  });
  if (merged.issues.length > 0) {
    throw new CliError(merged.issues.map((i) => renderIssue(i, dir, total)).join("\n"));
  }

  const index = buildTermIndex({
    lectureId: manifest.lectureId,
    course: manifest.course,
    generated: nowIso(),
    pages: merged.pages,
  });
  const parsed = TermIndexSchema.safeParse(index);
  if (!parsed.success) {
    throw new CliError(`the merged term index is not valid:\n${formatIssues(toIssues(parsed.error))}`);
  }

  const file = at(dir, FILES.terms);
  await writeAtomic(file, canonicalJson(index));

  manifest.status.terms = nowIso();
  await writeManifest(dir, manifest);

  const removed: string[] = [];
  if (opts.clean === true) {
    for (const f of files) {
      await rm(f, { force: true });
      removed.push(path.basename(f));
    }
    await rmdir(partialDir(dir)).catch(() => undefined);
  }

  return {
    file,
    index,
    sources: files.map((f) => path.basename(f)),
    filled: merged.filled,
    clamped,
    removed,
  };
}

/** "6 pages, terms per page min 0 / median 3 / max 7, glossary 14 terms" */
export function summarizeMerge(result: MergeTermsResult): string {
  const counts = result.index.pages.map((p: TermPage) => p.terms.length).sort((a, b) => a - b);
  const zero = result.index.pages.filter((p: TermPage) => p.terms.length === 0).map((p) => p.page);
  const lines = [
    `wrote ${result.file}`,
    `  merged ${result.sources.length} partial(s): ${result.sources.join(", ")}`,
    `  ${result.index.pages.length} pages, terms per page min ${counts[0] ?? 0} / ` +
      `median ${median(counts)} / max ${counts[counts.length - 1] ?? 0}`,
    `  glossary ${result.index.glossary.length} terms`,
    `  pages with zero terms: ${zero.length === 0 ? "none" : zero.join(", ")}`,
  ];
  if (result.filled.length > 0) {
    lines.push(`  filled with empty pages (--allow-missing): ${result.filled.join(", ")}`);
  }
  for (const c of result.clamped) {
    lines.push(`  warning: ${c.source} page ${c.page} had ${c.from} asrBias terms, clamped to ${MAX_PAGE_BIAS_TERMS}`);
  }
  if (result.removed.length > 0) {
    lines.push(`  removed ${result.removed.length} partial(s) (--clean)`);
  }
  return lines.join("\n");
}
