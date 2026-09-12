import { lineSelectionLink, pageLink } from "../obsidian.js";
import type { LectureManifest } from "../schemas/lecture.js";
import type { LectureNotes, Note, NotePage, OpenQuestion } from "../schemas/notes.js";
import type { SpanIndex, SpanPage } from "../schemas/spans.js";
import type { Term, TermIndex } from "../schemas/terms.js";

export interface RenderMarkdownOptions {
  /** Include each generated note's transcript evidence as a nested quote. */
  quotes: boolean;
}

export interface RenderLectureMarkdownInput {
  manifest: LectureManifest;
  notes: LectureNotes;
  /** Optional: without it the export carries notes but no "Terms on this slide". */
  terms?: TermIndex | null;
  /** Optional: without it note lines fall back to plain page links. */
  spans?: SpanIndex | null;
  options: RenderMarkdownOptions;
}

export interface LectureMarkdownStats {
  /** `## Slide N` sections written. */
  sections: number;
  noteLines: number;
  termLines: number;
  openQuestions: number;
  /** Pages skipped because they had neither a note nor a term. */
  skippedPages: number[];
}

/**
 * `mm:ss` on the audio clock. Hours roll into the minutes field — a lecture is
 * one timeline, and `75:12` is easier to find in an audio scrubber than
 * `1:15:12` is to add up.
 */
export function mmss(t: number): string {
  const total = Math.max(0, Math.floor(t));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * A note is one line of Markdown inside a list item, so the only things that
 * can break the page are a `]]` that closes a wikilink the note did not open
 * and a leading `#`. Everything else — maths, quotes, underscores — is left
 * exactly as the professor said it, because mangling notation to appease a
 * parser is worse than an italic run.
 */
export function escapeInline(text: string): string {
  const flat = text.replace(/\s*\r?\n\s*/g, " ").trim();
  const guarded = flat.replace(/]]/g, "]\\]");
  return guarded.startsWith("#") ? `\\${guarded}` : guarded;
}

/** A YAML scalar: bare when it cannot be mistaken for anything else, else quoted. */
export function yamlScalar(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(value) ? value : JSON.stringify(value);
}

function frontMatter(manifest: LectureManifest, notes: LectureNotes): string[] {
  const lines = ["---", `course: ${yamlScalar(manifest.course)}`];
  if (manifest.number !== undefined) lines.push(`lecture: ${manifest.number}`);
  if (manifest.title !== undefined && manifest.title !== "") {
    lines.push(`title: ${yamlScalar(manifest.title)}`);
  }
  lines.push(`date: ${manifest.date}`);
  lines.push(`deck: ${JSON.stringify(`[[${manifest.deck.file}]]`)}`);
  lines.push(`generated: ${notes.generated}`);
  lines.push("---");
  return lines;
}

function heading(manifest: LectureManifest, notes: LectureNotes): string {
  const title = manifest.title !== undefined && manifest.title !== "" ? manifest.title : null;
  if (manifest.number !== undefined) {
    const n = String(manifest.number).padStart(2, "0");
    return title === null ? `# Lecture ${n}` : `# Lecture ${n}: ${title}`;
  }
  if (title !== null) return `# ${title}`;
  return `# ${notes.lectureId}`;
}

/** The link that anchors a note: its lines when it has them, its page when not. */
function noteLink(
  deckFile: string,
  page: number,
  spanPage: SpanPage | undefined,
  lineIds: readonly number[],
): string | null {
  if (lineIds.length === 0) return null;
  if (spanPage === undefined) return pageLink(deckFile, page);
  return lineSelectionLink(deckFile, page, spanPage, [...lineIds], "slide");
}

function noteLines(
  note: Note,
  deckFile: string,
  page: number,
  spanPage: SpanPage | undefined,
  options: RenderMarkdownOptions,
): string[] {
  const prefix = note.kind === "student" ? "**me:** " : "";
  const parts = [`- ${prefix}${escapeInline(note.text)}`];
  const link = noteLink(deckFile, page, spanPage, note.lineIds);
  if (link !== null) parts.push(link);
  if (note.tStart !== null) parts.push(`\`${mmss(note.tStart)}\``);
  const out = [parts.join(" ")];

  if (note.answer !== undefined && note.answer !== "") {
    const answer = [`  - answered: ${escapeInline(note.answer)}`];
    if (note.tEnd !== null) answer.push(`\`${mmss(note.tEnd)}\``);
    out.push(answer.join(" "));
  }
  if (options.quotes && note.kind === "generated" && note.quote !== undefined && note.quote !== "") {
    out.push(`  - > "${escapeInline(note.quote)}"`);
  }
  return out;
}

/** `- **term**: definition Intuition: intuition Here: inThisCourse` */
export function termLine(term: Term): string {
  const parts = [`- **${escapeInline(term.term)}**: ${escapeInline(term.definition)}`];
  if (term.intuition !== "") parts.push(`Intuition: ${escapeInline(term.intuition)}`);
  if (term.inThisCourse !== "") parts.push(`Here: ${escapeInline(term.inThisCourse)}`);
  return parts.join(" ");
}

function openQuestionLine(question: OpenQuestion): string {
  const where =
    question.tStart === null
      ? `(slide ${question.page})`
      : `(slide ${question.page}, \`${mmss(question.tStart)}\`)`;
  return `- ${escapeInline(question.text)} ${where}`;
}

interface PageParts {
  page: NotePage;
  terms: Term[];
  title: string;
}

function collectPages(input: RenderLectureMarkdownInput): { included: PageParts[]; skipped: number[] } {
  const termPages = new Map((input.terms?.pages ?? []).map((p) => [p.page, p]));
  const included: PageParts[] = [];
  const skipped: number[] = [];
  for (const page of input.notes.pages) {
    const termPage = termPages.get(page.page);
    const terms = termPage?.terms ?? [];
    if (page.notes.length === 0 && terms.length === 0) {
      skipped.push(page.page);
      continue;
    }
    const title = page.title !== "" ? page.title : (termPage?.title ?? "");
    included.push({ page, terms: [...terms], title });
  }
  return { included, skipped };
}

/**
 * The one Markdown file per lecture that lives in the Obsidian vault
 * (architecture.md §4.8).
 *
 * Deterministic given its inputs: the only clock it reads is the one already
 * stamped into `notes.generated`. Blocks are separated by exactly one blank
 * line, no line carries trailing whitespace, and the file ends in a single
 * newline, so re-exporting an unchanged lecture leaves the vault's git history
 * alone.
 */
export function renderLectureMarkdown(input: RenderLectureMarkdownInput): string {
  const deckFile = input.manifest.deck.file;
  const spanPages = new Map((input.spans?.pages ?? []).map((p) => [p.page, p]));
  const blocks: string[] = [];

  blocks.push(frontMatter(input.manifest, input.notes).join("\n"));
  blocks.push(heading(input.manifest, input.notes));

  const { included } = collectPages(input);
  for (const { page, terms, title } of included) {
    const label = title === "" ? `## Slide ${page.page}` : `## Slide ${page.page}: ${escapeInline(title)}`;
    blocks.push(`${label}  ${pageLink(deckFile, page.page)}`);

    if (page.notes.length > 0) {
      const lines: string[] = [];
      for (const note of page.notes) {
        lines.push(...noteLines(note, deckFile, page.page, spanPages.get(page.page), input.options));
      }
      blocks.push(lines.join("\n"));
    }
    if (terms.length > 0) {
      blocks.push(["Terms on this slide", ...terms.map(termLine)].join("\n"));
    }
  }

  if (input.notes.openQuestions.length > 0) {
    blocks.push("## Open questions");
    blocks.push(input.notes.openQuestions.map(openQuestionLine).join("\n"));
  }

  return `${blocks.join("\n\n")}\n`;
}

/** What `lecture export-md` reports, computed from the same inputs as the file. */
export function lectureMarkdownStats(input: RenderLectureMarkdownInput): LectureMarkdownStats {
  const { included, skipped } = collectPages(input);
  let noteLines = 0;
  let termLines = 0;
  for (const { page, terms } of included) {
    noteLines += page.notes.length;
    termLines += terms.length;
  }
  return {
    sections: included.length,
    noteLines,
    termLines,
    openQuestions: input.notes.openQuestions.length,
    skippedPages: skipped,
  };
}
