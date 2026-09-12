import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  LectureNotesSchema,
  formatIssues,
  lectureMarkdownStats,
  renderLectureMarkdown,
  toIssues,
  type LectureMarkdownStats,
  type LectureNotes,
  type SpanIndex,
} from "@lecture/core";
import { at, FILES, readManifest, writeManifest } from "../folder.js";
import { CliError, exists, nowIso, writeAtomic } from "../util.js";
import { readTermIndex } from "./notes-context.js";

export interface ExportMarkdownOptions {
  quotes?: boolean;
  /** Write somewhere other than `<dir>/<lectureId>.md`. */
  out?: string;
}

export interface ExportMarkdownResult {
  file: string;
  markdown: string;
  stats: LectureMarkdownStats;
  /** Non-fatal notes for stderr: no terms, no spans. */
  warnings: string[];
}

export async function readLectureNotes(dir: string): Promise<LectureNotes> {
  const file = at(dir, FILES.notes);
  if (!(await exists(file))) {
    throw new CliError(
      `no ${FILES.notes} in ${dir} — run the /lecture-notes skill and \`lecture merge notes ${dir}\` first`,
    );
  }
  const parsed = LectureNotesSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new CliError(`${file} is not a valid LectureNotes:\n${formatIssues(toIssues(parsed.error))}`);
  }
  return parsed.data;
}

/** The Markdown file the vault holds for this lecture: `<lecture-id>.md`. */
export function markdownFile(dir: string, lectureId: string): string {
  return path.join(dir, `${lectureId}.md`);
}

/**
 * Render `notes.json` and `terms.json` into the one Markdown file per lecture
 * (architecture.md §4.8) and move it into place.
 *
 * `writeAtomic` writes `<name>.md.tmp` and renames, so Obsidian — which
 * watches the vault directory — never indexes half a file.
 */
export async function exportMarkdown(
  dir: string,
  opts: ExportMarkdownOptions = {},
): Promise<ExportMarkdownResult> {
  const manifest = await readManifest(dir);
  const notes = await readLectureNotes(dir);
  const warnings: string[] = [];

  const terms = await readTermIndex(dir);
  if (terms === null) {
    warnings.push(`no ${FILES.terms} in ${dir}; the export carries notes but no "Terms on this slide" blocks`);
  }

  let spans: SpanIndex | null = null;
  const spansFile = at(dir, FILES.spans);
  if (await exists(spansFile)) {
    spans = JSON.parse(await readFile(spansFile, "utf8")) as SpanIndex;
  } else {
    warnings.push(`no ${FILES.spans} in ${dir}; note links fall back to page links without a selection`);
  }

  const input = {
    manifest,
    notes,
    terms,
    spans,
    options: { quotes: opts.quotes === true },
  };
  const markdown = renderLectureMarkdown(input);
  const stats = lectureMarkdownStats(input);

  const file = opts.out === undefined ? markdownFile(dir, manifest.lectureId) : opts.out;
  await writeAtomic(file, markdown);

  manifest.status.exported = nowIso();
  await writeManifest(dir, manifest);

  return { file, markdown, stats, warnings };
}

export function summarizeExport(result: ExportMarkdownResult): string {
  const s = result.stats;
  const lines = [
    `wrote ${result.file}`,
    `  ${s.sections} slide section(s), ${s.noteLines} note line(s), ${s.termLines} term line(s), ` +
      `${s.openQuestions} open question(s)`,
  ];
  if (s.skippedPages.length > 0) {
    lines.push(`  pages with neither notes nor terms, skipped: ${s.skippedPages.join(", ")}`);
  }
  return lines.join("\n");
}
