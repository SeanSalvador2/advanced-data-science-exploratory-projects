import { readFile, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import {
  LectureNotesSchema,
  NotePageSchema,
  OpenQuestionSchema,
  formatIssues,
  mergeNotePages,
  noteId,
  pageSpan,
  toIssues,
  transcribedPages,
  type LectureNotes,
  type MergeNoteIssue,
  type NotePage,
  type NotesPartial,
  type OpenQuestion,
} from "@lecture/core";
import { at, FILES, readManifest, writeManifest } from "../folder.js";
import { CliError, canonicalJson, exists, nowIso, writeAtomic } from "../util.js";
import { readTermIndex, readTranscript } from "./notes-context.js";

/** Where `/lecture-notes` drops one file per batch (architecture.md §3, §6). */
export const NOTES_PARTIAL_DIR = path.join(".lecture", "notes.partial");

export interface MergeNotesOptions {
  allowMissing?: boolean;
  clean?: boolean;
}

export interface CheckNotesResult {
  sources: string[];
  /** Deck pages no partial covers yet. */
  uncovered: number[];
  /** Of those, the ones the transcript says were shown — the ones that matter. */
  missingShown: number[];
}

export interface MergeNotesResult {
  file: string;
  notes: LectureNotes;
  sources: string[];
  uncovered: number[];
  missingShown: number[];
  duplicateQuestions: number;
  removed: string[];
}

export function notesPartialDir(dir: string): string {
  return at(dir, NOTES_PARTIAL_DIR);
}

async function listPartials(dir: string): Promise<string[]> {
  const root = notesPartialDir(dir);
  if (!(await exists(root))) {
    throw new CliError(
      `no ${NOTES_PARTIAL_DIR} in ${dir} — run the /lecture-notes skill first, it writes one JSON file per batch`,
    );
  }
  const names = (await readdir(root)).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) {
    throw new CliError(`${root} holds no .json files — nothing to merge`);
  }
  return names.map((n) => path.join(root, n));
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

/**
 * Read one partial: `{ "pages": NotePage[], "openQuestions": OpenQuestion[] }`.
 *
 * Note ids are optional in a partial. The model is writing notes, not
 * allocating identifiers, and every id is reassigned at merge time anyway —
 * so a missing one is filled with a provisional value before validation
 * rather than reported as an error.
 */
export function readNotesPartial(
  file: string,
  raw: unknown,
): { partial: NotesPartial; errors: string[] } {
  const name = path.basename(file);
  const errors: string[] = [];
  const pages: NotePage[] = [];
  const openQuestions: OpenQuestion[] = [];
  // `pages` and `openQuestions` are filled in below by reference.
  const result = { partial: { source: name, pages, openQuestions }, errors };

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push(`${name}: expected a JSON object with "pages" and "openQuestions"`);
    return result;
  }
  const record = raw as { pages?: unknown; openQuestions?: unknown };

  if (!Array.isArray(record.pages)) {
    errors.push(`${name}: expected a "pages" array, got ${describe(record.pages)}`);
  } else {
    record.pages.forEach((entry, i) => {
      const where = pageLabel(entry, i);
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        errors.push(`${name} ${where}: expected an object`);
        return;
      }
      const parsed = NotePageSchema.safeParse(withNoteIds(entry as Record<string, unknown>));
      if (!parsed.success) {
        errors.push(`${name} ${where}:\n${formatIssues(toIssues(parsed.error))}`);
        return;
      }
      pages.push(parsed.data);
    });
  }

  const questions = record.openQuestions;
  if (questions === undefined) {
    // A batch where nothing was left hanging writes no key at all.
  } else if (!Array.isArray(questions)) {
    errors.push(`${name}: expected an "openQuestions" array, got ${describe(questions)}`);
  } else {
    questions.forEach((entry, i) => {
      const parsed = OpenQuestionSchema.safeParse(entry);
      if (!parsed.success) {
        errors.push(`${name} openQuestions[${i}]:\n${formatIssues(toIssues(parsed.error))}`);
        return;
      }
      openQuestions.push(parsed.data);
    });
  }

  return result;
}

/** Fill in any absent note id so the page can be validated as a `NotePage`. */
function withNoteIds(page: Record<string, unknown>): Record<string, unknown> {
  const notes = page["notes"];
  if (!Array.isArray(notes)) return page;
  const n = typeof page["page"] === "number" ? (page["page"] as number) : 0;
  return {
    ...page,
    notes: notes.map((note, i) => {
      if (typeof note !== "object" || note === null || Array.isArray(note)) return note;
      const record = note as Record<string, unknown>;
      const id = record["id"];
      return typeof id === "string" && id !== "" ? record : { ...record, id: noteId(n, i + 1) };
    }),
  };
}

async function readAllPartials(dir: string): Promise<{ files: string[]; partials: NotesPartial[] }> {
  const files = await listPartials(dir);
  const partials: NotesPartial[] = [];
  const errors: string[] = [];
  for (const file of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      errors.push(`${path.basename(file)}: not valid JSON — ${(err as Error).message}`);
      continue;
    }
    const read = readNotesPartial(file, raw);
    partials.push(read.partial);
    errors.push(...read.errors);
  }
  if (errors.length > 0) {
    throw new CliError(`${errors.length} problem(s) in ${path.join(dir, NOTES_PARTIAL_DIR)}:\n${errors.join("\n")}`);
  }
  return { files, partials };
}

function renderIssue(issue: MergeNoteIssue, dir: string, total: number): string {
  if (issue.kind === "duplicate") {
    return `page ${issue.page} appears in more than one partial: ${issue.sources.join(", ")}`;
  }
  if (issue.kind === "out-of-range") {
    return `page ${issue.page} is not in the deck (${total} pages): ${issue.sources.join(", ")}`;
  }
  if (issue.kind === "invalid") {
    return `${JSON.stringify(issue.page)} is not a page number: ${issue.sources.join(", ")}`;
  }
  return (
    `${issue.pages.length} page(s) were shown and talked over but no partial covers them: ${issue.pages.join(", ")}\n` +
    `  in ${path.join(dir, NOTES_PARTIAL_DIR)}\n` +
    `  re-run those batches, or pass --allow-missing if the professor genuinely added nothing there`
  );
}

/**
 * Everything the merge needs besides the partials: which pages the transcript
 * covers and where, and what each page is called.
 */
async function pageContext(dir: string): Promise<{
  spans: Map<number, { startS: number; endS: number }>;
  titles: Map<number, string>;
}> {
  const spans = new Map<number, { startS: number; endS: number }>();
  const titles = new Map<number, string>();
  if (await exists(at(dir, FILES.transcript))) {
    const transcript = await readTranscript(dir);
    for (const page of transcribedPages(transcript)) {
      const span = pageSpan(transcript, page);
      if (span !== null) spans.set(page, span);
    }
  }
  const terms = await readTermIndex(dir);
  for (const page of terms?.pages ?? []) titles.set(page.page, page.title);
  return { spans, titles };
}

/**
 * Validate what has been written so far and write nothing, so a skill can
 * check the batch it has just finished. Uncovered pages are listed, not
 * refused: mid-run that is the normal state.
 */
export async function checkNotesPartials(dir: string): Promise<CheckNotesResult> {
  const manifest = await readManifest(dir);
  const { files, partials } = await readAllPartials(dir);
  const { spans, titles } = await pageContext(dir);

  const merged = mergeNotePages(partials, manifest.deck.pages, {
    lectureId: manifest.lectureId,
    generated: nowIso(),
    allowMissing: true,
    spans,
    titles,
  });
  if (merged.issues.length > 0) {
    throw new CliError(merged.issues.map((i) => renderIssue(i, dir, manifest.deck.pages)).join("\n"));
  }
  return {
    sources: files.map((f) => path.basename(f)),
    uncovered: merged.uncovered,
    missingShown: merged.missingShown,
  };
}

export function summarizeNotesCheck(result: CheckNotesResult): string {
  const lines = [
    `ok  ${result.sources.length} partial(s) validate: ${result.sources.join(", ")}`,
    `  pages not written yet: ${result.uncovered.length === 0 ? "none" : result.uncovered.join(", ")}`,
    `  of those, shown in the lecture: ${result.missingShown.length === 0 ? "none" : result.missingShown.join(", ")}`,
  ];
  return lines.join("\n");
}

/**
 * Merge every batch file into `notes.json` (architecture.md §6): validate each
 * page, refuse duplicates and pages outside the deck, insist every page the
 * transcript covers was looked at, reassign note ids in reading order, dedupe
 * the open questions, then stamp the manifest.
 */
export async function mergeNotes(dir: string, opts: MergeNotesOptions = {}): Promise<MergeNotesResult> {
  const manifest = await readManifest(dir);
  const total = manifest.deck.pages;
  const { files, partials } = await readAllPartials(dir);
  const { spans, titles } = await pageContext(dir);

  const merged = mergeNotePages(partials, total, {
    lectureId: manifest.lectureId,
    generated: nowIso(),
    ...(opts.allowMissing === undefined ? {} : { allowMissing: opts.allowMissing }),
    spans,
    titles,
  });
  if (merged.issues.length > 0) {
    throw new CliError(merged.issues.map((i) => renderIssue(i, dir, total)).join("\n"));
  }

  const parsed = LectureNotesSchema.safeParse(merged.notes);
  if (!parsed.success) {
    throw new CliError(`the merged notes are not valid:\n${formatIssues(toIssues(parsed.error))}`);
  }

  const file = at(dir, FILES.notes);
  await writeAtomic(file, canonicalJson(merged.notes));

  manifest.status.notes = nowIso();
  await writeManifest(dir, manifest);

  const removed: string[] = [];
  if (opts.clean === true) {
    for (const f of files) {
      await rm(f, { force: true });
      removed.push(path.basename(f));
    }
    await rmdir(notesPartialDir(dir)).catch(() => undefined);
  }

  return {
    file,
    notes: merged.notes,
    sources: files.map((f) => path.basename(f)),
    uncovered: merged.uncovered,
    missingShown: merged.missingShown,
    duplicateQuestions: merged.duplicateQuestions,
    removed,
  };
}

export function summarizeNotesMerge(result: MergeNotesResult): string {
  const pages = result.notes.pages;
  const withNotes = pages.filter((p) => p.notes.length > 0);
  const all = pages.flatMap((p) => p.notes);
  const generated = all.filter((n) => n.kind === "generated").length;
  const student = all.length - generated;
  const byConfidence = (c: "high" | "medium" | "low"): number =>
    all.filter((n) => n.confidence === c).length;
  const answered = all.filter((n) => n.kind === "student" && n.answer !== undefined).length;

  const lines = [
    `wrote ${result.file}`,
    `  merged ${result.sources.length} partial(s): ${result.sources.join(", ")}`,
    `  ${withNotes.length} of ${pages.length} pages have notes: ${
      withNotes.length === 0 ? "none" : withNotes.map((p) => `${p.page}(${p.notes.length})`).join(" ")
    }`,
    `  ${all.length} notes: ${generated} generated, ${student} student (${answered} answered)`,
    `  confidence: high ${byConfidence("high")} / medium ${byConfidence("medium")} / low ${byConfidence("low")}`,
    `  open questions: ${result.notes.openQuestions.length}`,
  ];
  if (result.uncovered.length > 0) {
    lines.push(`  pages no partial covered: ${result.uncovered.join(", ")}`);
  }
  if (result.missingShown.length > 0) {
    lines.push(`  warning: shown but not noted (--allow-missing): ${result.missingShown.join(", ")}`);
  }
  if (result.duplicateQuestions > 0) {
    lines.push(`  dropped ${result.duplicateQuestions} repeated open question(s)`);
  }
  const low = pages.flatMap((p) => p.notes.filter((n) => n.confidence === "low").map((n) => `${n.id}`));
  if (low.length > 0) lines.push(`  low confidence: ${low.join(", ")}`);
  if (result.removed.length > 0) {
    lines.push(`  removed ${result.removed.length} partial(s) (--clean)`);
  }
  return lines.join("\n");
}
