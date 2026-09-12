import { readFile } from "node:fs/promises";
import {
  EventSchema,
  RecordingMetaSchema,
  TermIndexSchema,
  TranscriptSchema,
  formatIssues,
  lastSegmentEnd,
  recordingDuration,
  segmentsForPage,
  slideWindows,
  studentNotes,
  toIssues,
  type Event,
  type RecordingMeta,
  type SlideWindow,
  type SpanLineKind,
  type TermIndex,
  type Transcript,
} from "@lecture/core";
import { at, FILES, readManifest } from "../folder.js";
import { CliError, exists } from "../util.js";
import { readSpanIndex } from "./extract-spans.js";
import { parsePageRange } from "./terms-context.js";

export interface NotesContextLine {
  id: number;
  text: string;
  kind?: SpanLineKind;
}

export interface NotesContextTerm {
  id: string;
  term: string;
  aliases: string[];
}

/** A transcript segment with its words dropped: the skill reads text, not timing. */
export interface NotesContextSegment {
  start: number;
  end: number;
  text: string;
}

export interface NotesContextStudentNote {
  t: number;
  text: string;
}

export interface NotesContextWindow {
  startS: number;
  endS: number;
}

export interface NotesContextPage {
  page: number;
  title: string;
  summary: string;
  lines: NotesContextLine[];
  terms: NotesContextTerm[];
  /** The whole time the page was on screen, first visit's start to last visit's end. */
  window: NotesContextWindow | null;
  /** One entry per visit; a page shown twice has two. */
  windows: NotesContextWindow[];
  segments: NotesContextSegment[];
  studentNotes: NotesContextStudentNote[];
}

/** Everything `/lecture-notes` needs for one batch of pages. */
export interface NotesContext {
  lectureId: string;
  course: string;
  recordingPresent: boolean;
  pages: NotesContextPage[];
}

export interface NotesContextResult {
  context: NotesContext;
  warnings: string[];
  from: number;
  to: number;
}

/**
 * Read `events.jsonl`. A line that will not parse is a warning, not a failure:
 * the app appends to this file during a lecture and a crash mid-write should
 * cost one event, not the whole set of notes.
 */
export async function readEvents(dir: string): Promise<{ events: Event[]; warnings: string[] }> {
  const file = at(dir, FILES.events);
  const warnings: string[] = [];
  if (!(await exists(file))) {
    return { events: [], warnings: [`no ${FILES.events} in ${dir}; no slide timing or typed notes`] };
  }
  const events: Event[] = [];
  const lines = (await readFile(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      warnings.push(`${FILES.events} line ${i + 1}: not valid JSON, skipped`);
      return;
    }
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) {
      warnings.push(`${FILES.events} line ${i + 1}: not a valid Event, skipped`);
      return;
    }
    events.push(parsed.data);
  });
  return { events, warnings };
}

export async function readRecording(dir: string): Promise<RecordingMeta | null> {
  const file = at(dir, FILES.recording);
  if (!(await exists(file))) return null;
  const parsed = RecordingMetaSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new CliError(`${file} is not a valid RecordingMeta:\n${formatIssues(toIssues(parsed.error))}`);
  }
  return parsed.data;
}

/**
 * `transcript.json`, or a message naming the step that writes it. Notes come
 * from what was said, so there is nothing useful to do without it.
 */
export async function readTranscript(dir: string): Promise<Transcript> {
  const file = at(dir, FILES.transcript);
  if (!(await exists(file))) {
    throw new CliError(
      `no ${FILES.transcript} in ${dir} — run \`lecture-rec transcribe ${dir}\` first, ` +
        `then re-run this command`,
    );
  }
  const parsed = TranscriptSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new CliError(`${file} is not a valid Transcript:\n${formatIssues(toIssues(parsed.error))}`);
  }
  return parsed.data;
}

export async function readTermIndex(dir: string): Promise<TermIndex | null> {
  const file = at(dir, FILES.terms);
  if (!(await exists(file))) return null;
  const parsed = TermIndexSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new CliError(`${file} is not a valid TermIndex:\n${formatIssues(toIssues(parsed.error))}`);
  }
  return parsed.data;
}

function span(windows: SlideWindow[]): NotesContextWindow | null {
  if (windows.length === 0) return null;
  let startS = Number.POSITIVE_INFINITY;
  let endS = Number.NEGATIVE_INFINITY;
  for (const w of windows) {
    if (w.start < startS) startS = w.start;
    if (w.end > endS) endS = w.end;
  }
  return { startS, endS };
}

/**
 * Assemble the inputs for one batch of `/lecture-notes`.
 *
 * Every page of the range is emitted, including pages with no segments and no
 * typed notes: an empty page here is the signal that it was never shown, which
 * is information the skill needs in order to write nothing for it on purpose.
 *
 * Word arrays are dropped from the segments. They are most of the bytes of a
 * transcript and the prompt anchors on segment times, not word times.
 */
export async function notesContext(dir: string, pagesSpec: string): Promise<NotesContextResult> {
  const manifest = await readManifest(dir);
  const range = parsePageRange(pagesSpec, manifest.deck.pages);
  const warnings = [...range.warnings];

  const transcript = await readTranscript(dir);
  const spans = await readSpanIndex(dir);
  const recording = await readRecording(dir);
  const terms = await readTermIndex(dir);
  if (terms === null) warnings.push(`no ${FILES.terms} in ${dir}; pages carry no titles or terms`);
  const { events, warnings: eventWarnings } = await readEvents(dir);
  warnings.push(...eventWarnings);

  const duration = recordingDuration(recording, events, lastSegmentEnd(transcript));
  const windows = slideWindows(events, recording, duration);
  const typed = studentNotes(events, recording, windows);

  const spanPages = new Map(spans.pages.map((p) => [p.page, p]));
  const termPages = new Map((terms?.pages ?? []).map((p) => [p.page, p]));

  const pages: NotesContextPage[] = [];
  for (let n = range.from; n <= range.to; n += 1) {
    const spanPage = spanPages.get(n);
    if (spanPage === undefined) warnings.push(`page ${n} is missing from ${FILES.spans}`);
    const lines: NotesContextLine[] = [];
    for (const line of spanPage?.lines ?? []) {
      const text = line.text.trim();
      if (text === "") continue;
      lines.push({ id: line.id, text, ...(line.kind === undefined ? {} : { kind: line.kind }) });
    }
    const termPage = termPages.get(n);
    const visits = windows.get(n) ?? [];
    pages.push({
      page: n,
      title: termPage?.title ?? "",
      summary: termPage?.summary ?? "",
      lines,
      terms: (termPage?.terms ?? []).map((t) => ({ id: t.id, term: t.term, aliases: [...t.aliases] })),
      window: span(visits),
      windows: visits.map((w) => ({ startS: w.start, endS: w.end })),
      segments: segmentsForPage(transcript, n).map((s) => ({ start: s.start, end: s.end, text: s.text })),
      studentNotes: typed.filter((note) => note.page === n).map((note) => ({ t: note.t, text: note.text })),
    });
  }

  const unplaced = typed.filter((note) => note.page === null);
  if (unplaced.length > 0) {
    warnings.push(
      `${unplaced.length} typed note(s) fall outside every slide window and are on no page: ` +
        unplaced.map((n) => JSON.stringify(n.text)).join(", "),
    );
  }

  return {
    context: {
      lectureId: manifest.lectureId,
      course: manifest.course,
      recordingPresent: recording !== null,
      pages,
    },
    warnings,
    from: range.from,
    to: range.to,
  };
}
