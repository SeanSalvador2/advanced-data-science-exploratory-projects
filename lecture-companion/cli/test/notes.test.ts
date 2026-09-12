import { cp, readFile, readdir, rm, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateFile, type LectureNotes, type SpanIndex } from "@lecture/core";
import { notesContext } from "../src/commands/notes-context.js";
import {
  checkNotesPartials,
  mergeNotes,
  summarizeNotesCheck,
  summarizeNotesMerge,
  NOTES_PARTIAL_DIR,
} from "../src/commands/merge-notes.js";
import { exportMarkdown, summarizeExport } from "../src/commands/export-md.js";
import { status, renderStatus } from "../src/commands/status.js";
import { CliError } from "../src/util.js";
import { buildNotesLecture, NOTES_PARTIALS } from "./notes-lecture.js";

let root = "";
/** A prepared, recorded, transcribed folder, copied per test. */
let master = "";

async function lecture(name: string, partials?: string): Promise<string> {
  const dir = path.join(root, name);
  await cp(master, dir, { recursive: true });
  if (partials !== undefined) {
    await cp(path.join(NOTES_PARTIALS, partials), path.join(dir, NOTES_PARTIAL_DIR), { recursive: true });
  }
  return dir;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lecture-notes-"));
  master = await buildNotesLecture(path.join(root, "master"));
}, 180_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("notes-context", () => {
  it("gives every page of the batch, with lines, terms, segments and typed notes", async () => {
    const dir = await lecture("context");
    const { context } = await notesContext(dir, "1-6");

    expect(context.lectureId).toBe("2026-09-15-lec05");
    expect(context.course).toBe("TDL");
    expect(context.recordingPresent).toBe(true);
    expect(context.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);

    const page2 = context.pages[1];
    expect(page2?.title).toBe("Randomized smoothing");
    expect(page2?.lines[1]).toMatchObject({ id: 1, text: "• Add Gaussian noise at prediction time" });
    expect(page2?.terms.map((t) => t.id)).toContain("t-randomized-smoothing");
  });

  it("gives a revisited page both of its windows and both stretches of transcript", async () => {
    const dir = await lecture("context-revisit");
    const { context } = await notesContext(dir, "1-6");
    const page3 = context.pages[2];

    expect(page3?.windows).toEqual([
      { startS: 330, endS: 540 },
      { startS: 720, endS: 900 },
    ]);
    expect(page3?.window).toEqual({ startS: 330, endS: 900 });
    expect(page3?.segments).toHaveLength(20);
    expect(page3?.segments[0]?.start).toBe(330);
    expect(page3?.segments[11]?.start).toBe(720);
    expect(page3?.segments.every((s) => typeof s.text === "string")).toBe(true);
  });

  it("emits a page that was never shown, with empty arrays", async () => {
    const dir = await lecture("context-skipped");
    const { context } = await notesContext(dir, "1-6");
    const page5 = context.pages[4];

    expect(page5).toMatchObject({ page: 5, window: null, windows: [], segments: [], studentNotes: [] });
    // Its lines are still there: the page exists, it just never went up.
    expect(page5?.lines).toHaveLength(4);
  });

  it("places each typed note on the page that was up when it was typed", async () => {
    const dir = await lecture("context-notes");
    const { context } = await notesContext(dir, "1-6");

    expect(context.pages[1]?.studentNotes).toEqual([
      { t: 220, text: "slide says noise at prediction time but he keeps saying you also train with it - same sigma both places" },
    ]);
    expect(context.pages[2]?.studentNotes).toEqual([{ t: 380, text: "why Phi inverse and not a tail bound?" }]);
    expect(context.pages[3]?.studentNotes).toEqual([
      { t: 615, text: "does a certified radius survive fine tuning the base classifier?" },
    ]);
    expect(context.pages[0]?.studentNotes).toEqual([]);
  });

  it("drops the word arrays: the prompt reads text, not word timings", async () => {
    const dir = await lecture("context-words");
    const { context } = await notesContext(dir, "1-2");
    const segment = context.pages[0]?.segments[0] as unknown as Record<string, unknown>;
    expect(Object.keys(segment).sort()).toEqual(["end", "start", "text"]);
  });

  it("names the transcribe step when transcript.json is missing", async () => {
    const dir = await lecture("context-no-transcript");
    await rm(path.join(dir, "transcript.json"));
    await expect(notesContext(dir, "1-6")).rejects.toThrow(/lecture-rec transcribe/u);
  });
});

describe("merge notes", () => {
  it("merges the hand-written batch, assigns ids and stamps the manifest", async () => {
    const dir = await lecture("merge-ok", "complete");
    const result = await mergeNotes(dir);

    expect(result.notes.lectureId).toBe("2026-09-15-lec05");
    expect(result.notes.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(result.uncovered).toEqual([]);

    const page2 = result.notes.pages[1];
    expect(page2?.notes.map((n) => n.id)).toEqual([
      "n-2-1",
      "n-2-2",
      "n-2-3",
      "n-2-4",
      "n-2-5",
      "n-2-6",
      "n-2-7",
    ]);
    // The typed note at 220 s sorts in among the generated notes by time.
    expect(page2?.notes[3]).toMatchObject({ id: "n-2-4", kind: "student", tStart: 220 });

    // A page that was never shown keeps an empty note list and null times.
    expect(result.notes.pages[4]).toEqual({ page: 5, title: "", startS: null, endS: null, notes: [] });

    expect(result.notes.openQuestions).toHaveLength(2);

    const written = await readJson<LectureNotes>(path.join(dir, "notes.json"));
    expect(validateFile(written).ok).toBe(true);
    expect(written).toEqual(result.notes);

    const report = await status(dir);
    expect(report.manifest?.status.notes).toBeDefined();
    expect(renderStatus(report)).toMatch(/notes\.json\s+present\s+6 pages, 31 notes/u);
  });

  it("writes the same bytes twice, apart from the generated stamp", async () => {
    const dir = await lecture("merge-stable", "complete");
    const a = await mergeNotes(dir);
    const b = await mergeNotes(dir);
    expect(JSON.stringify({ ...a.notes, generated: "" })).toBe(JSON.stringify({ ...b.notes, generated: "" }));
  });

  it("--check validates without writing, and says what is still missing", async () => {
    const dir = await lecture("check", "missing-shown");
    const result = await checkNotesPartials(dir);

    expect(result.sources).toEqual(["batch-01.json", "batch-02.json"]);
    expect(result.uncovered).toEqual([4]);
    expect(result.missingShown).toEqual([4]);
    expect(summarizeNotesCheck(result)).toContain("of those, shown in the lecture: 4");
    await expect(readFile(path.join(dir, "notes.json"))).rejects.toThrow();
  });

  it("refuses a page two partials both claim", async () => {
    const dir = await lecture("duplicate", "duplicate");
    await expect(mergeNotes(dir)).rejects.toThrow(
      /page 3 appears in more than one partial: batch-01\.json, batch-02\.json/u,
    );
  });

  it("refuses to skip a page that was shown and talked over, unless told to", async () => {
    const dir = await lecture("missing-shown", "missing-shown");
    await expect(mergeNotes(dir)).rejects.toThrow(/shown and talked over but no partial covers them: 4/u);

    const result = await mergeNotes(dir, { allowMissing: true });
    // Filled from the transcript's own coverage of the page.
    expect(result.notes.pages[3]).toEqual({ page: 4, title: "Two views", startS: 540, endS: 718.8, notes: [] });
    expect(summarizeNotesMerge(result)).toContain("shown but not noted (--allow-missing): 4");
  });

  it("names the file and the page when a note does not validate", async () => {
    const dir = await lecture("invalid", "invalid");
    await expect(mergeNotes(dir)).rejects.toThrow(/batch-01\.json page 3:[\s\S]*notes\.0\.tag/u);
  });

  it("refuses a page outside the deck", async () => {
    const dir = await lecture("out-of-range");
    const partials = path.join(dir, NOTES_PARTIAL_DIR);
    await cp(path.join(NOTES_PARTIALS, "complete"), partials, { recursive: true });
    await writeFile(
      path.join(partials, "batch-02.json"),
      JSON.stringify({ pages: [{ page: 9, title: "", startS: null, endS: null, notes: [] }], openQuestions: [] }),
    );
    await expect(mergeNotes(dir)).rejects.toThrow(/page 9 is not in the deck \(6 pages\)/u);
  });

  it("complains about a folder with no partials at all", async () => {
    const dir = await lecture("no-partials");
    await expect(mergeNotes(dir)).rejects.toBeInstanceOf(CliError);
    await expect(mergeNotes(dir)).rejects.toThrow(/run the \/lecture-notes skill first/u);
  });

  it("--clean removes the partials once the merge is trusted", async () => {
    const dir = await lecture("clean", "complete");
    const result = await mergeNotes(dir, { clean: true });
    expect(result.removed).toEqual(["batch-01.json"]);
    await expect(readdir(path.join(dir, NOTES_PARTIAL_DIR))).rejects.toThrow();
  });
});

describe("export-md", () => {
  it("writes <lectureId>.md with the headers, links and terms, and leaves no .tmp", async () => {
    const dir = await lecture("export", "complete");
    await mergeNotes(dir);
    const result = await exportMarkdown(dir);

    expect(result.file).toBe(path.join(dir, "2026-09-15-lec05.md"));
    const md = await readFile(result.file, "utf8");

    expect(md.startsWith("---\ncourse: TDL\nlecture: 5\ntitle: Certified Defenses\ndate: 2026-09-15\n")).toBe(true);
    expect(md).toContain('deck: "[[deck.pdf]]"');
    expect(md).toContain("# Lecture 05: Certified Defenses");
    expect(md).toContain("## Slide 3: The certificate  [[deck.pdf#page=3]]");
    expect(md).toContain("- **me:** why Phi inverse and not a tail bound?");
    expect(md).toContain("  - answered: Neyman-Pearson makes the worst case a half space");
    expect(md).toContain("Terms on this slide");
    expect(md).toContain("- **Phi inverse**: The inverse of the standard Gaussian");
    expect(md).toContain("## Open questions");
    expect(md).toMatch(/- Does the certificate still mean anything[^\n]*\(slide 6, `18:50`\)/u);

    // Page 5 was never shown and carries no terms, so it gets no section.
    expect(md).not.toContain("## Slide 5");
    expect(result.stats).toMatchObject({ sections: 5, skippedPages: [5] });
    expect(summarizeExport(result)).toContain("5 slide section(s)");

    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/[ \t]+\n/u);
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);

    expect((await status(dir)).manifest?.status.exported).toBeDefined();
  });

  it("every selection link names item indices that exist on that page in spans.json", async () => {
    const dir = await lecture("export-links", "complete");
    await mergeNotes(dir);
    const { file } = await exportMarkdown(dir);
    const md = await readFile(file, "utf8");
    const spans = await readJson<SpanIndex>(path.join(dir, "spans.json"));
    const byPage = new Map(spans.pages.map((p) => [p.page, p]));

    const links = [...md.matchAll(/\[\[deck\.pdf#page=(\d+)&selection=(\d+),(\d+),(\d+),(\d+)\|slide\]\]/gu)];
    expect(links.length).toBeGreaterThan(20);
    for (const [, page, beginItem, beginOffset, endItem, endOffset] of links) {
      const spanPage = byPage.get(Number(page));
      expect(spanPage, `page ${page} is in spans.json`).toBeDefined();
      const items = (spanPage as { items: Array<{ str: string }> }).items;
      expect(Number(beginItem), `page ${page} begin item exists`).toBeLessThan(items.length);
      expect(Number(endItem), `page ${page} end item exists`).toBeLessThan(items.length);
      expect(Number(beginItem)).toBeLessThanOrEqual(Number(endItem));
      expect(Number(beginOffset)).toBe(0);
      expect(Number(endOffset)).toBe((items[Number(endItem)] as { str: string }).str.length);
    }
  });

  it("--quotes adds the transcript evidence, and --out redirects the file", async () => {
    const dir = await lecture("export-quotes", "complete");
    await mergeNotes(dir);
    const out = path.join(dir, "with-quotes.md");
    const result = await exportMarkdown(dir, { quotes: true, out });

    expect(result.file).toBe(out);
    const md = await readFile(out, "utf8");
    expect(md).toContain('  - > "the distance from the centre of a Gaussian to a half space');
  });

  it("exports without terms.json, warning and dropping the Terms blocks", async () => {
    const dir = await lecture("export-no-terms", "complete");
    await mergeNotes(dir);
    await rm(path.join(dir, "terms.json"));
    const result = await exportMarkdown(dir);

    expect(result.warnings.join("\n")).toContain("no terms.json");
    expect(result.markdown).not.toContain("Terms on this slide");
    expect(result.markdown).toContain("## Slide 2: Randomized smoothing");
  });

  it("names the merge step when notes.json is missing", async () => {
    const dir = await lecture("export-no-notes");
    await expect(exportMarkdown(dir)).rejects.toThrow(/lecture merge notes/u);
  });
});
