import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BiasTermsSchema, validateFile, type TermIndex } from "@lecture/core";
import { prepare } from "../src/commands/prepare.js";
import { parsePageRange, termsContext, PRIOR_DEFINITION_MAX } from "../src/commands/terms-context.js";
import {
  checkPartials,
  mergeTerms,
  summarizeCheck,
  summarizeMerge,
  PARTIAL_DIR,
} from "../src/commands/merge-terms.js";
import { bias, summarizeBias } from "../src/commands/bias.js";
import { status, renderStatus } from "../src/commands/status.js";
import { CliError } from "../src/util.js";
import { FIXTURES } from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PARTIALS = path.join(here, "fixtures", "terms-partials");

let root = "";
/** A prepared 6-page folder, copied per test rather than re-prepared. */
let master = "";

/** Copy the prepared folder and, optionally, one set of hand-written partials. */
async function lecture(name: string, partials?: string): Promise<string> {
  const dir = path.join(root, name);
  await cp(master, dir, { recursive: true });
  if (partials !== undefined) {
    await cp(path.join(PARTIALS, partials), path.join(dir, PARTIAL_DIR), { recursive: true });
  }
  return dir;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lecture-terms-"));
  master = path.join(root, "2026-09-15-lec05");
  await prepare(master, {
    deck: FIXTURES.html,
    course: "TDL",
    date: "2026-09-15",
    prior: ["2026-09-08-lec04"],
  });
}, 180_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("parsePageRange", () => {
  it("reads a-b and a bare page", () => {
    expect(parsePageRange("1-8", 40)).toEqual({ from: 1, to: 8, warnings: [] });
    expect(parsePageRange(" 3 ", 40)).toEqual({ from: 3, to: 3, warnings: [] });
  });

  it("clamps the last batch to the deck and says so", () => {
    const range = parsePageRange("1-8", 6);
    expect(range).toMatchObject({ from: 1, to: 6 });
    expect(range.warnings[0]).toContain("clamped to 1-6");
  });

  it("refuses nonsense", () => {
    expect(() => parsePageRange("one to eight", 6)).toThrow(/--pages must look like/);
    expect(() => parsePageRange("0-3", 6)).toThrow(/starts at page 1/);
    expect(() => parsePageRange("5-2", 6)).toThrow(/backwards/);
    expect(() => parsePageRange("9-12", 6)).toThrow(/past the end of the deck/);
  });
});

describe("terms-context", () => {
  it("prints the batch's pages with their line ids", async () => {
    const dir = await lecture("context");
    const { context } = await termsContext(dir, "1-8");
    expect(context.lectureId).toBe("2026-09-15-lec05");
    expect(context.course).toBe("TDL");
    expect(context.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const page of context.pages) {
      expect(page.lines.length).toBeGreaterThan(0);
      for (const line of page.lines) {
        expect(line.text.trim()).toBe(line.text);
        expect(line.text).not.toBe("");
        expect(Number.isInteger(line.id)).toBe(true);
      }
    }
    expect(context.pages[0]?.lines[0]).toEqual({ id: 0, text: "Certified Defenses", kind: "title" });
  });

  it("returns only the pages of the batch", async () => {
    const dir = await lecture("context-batch");
    const { context } = await termsContext(dir, "3-4");
    expect(context.pages.map((p) => p.page)).toEqual([3, 4]);
  });

  it("keeps the line ids from spans.json, holes included", async () => {
    const dir = await lecture("context-ids");
    const { context } = await termsContext(dir, "1-6");
    const spans = await readJson<{ pages: { page: number; lines: { id: number; text: string }[] }[] }>(
      path.join(dir, "spans.json"),
    );
    for (const page of context.pages) {
      const source = spans.pages.find((p) => p.page === page.page);
      const kept = (source?.lines ?? []).filter((l) => l.text.trim() !== "").map((l) => l.id);
      expect(page.lines.map((l) => l.id)).toEqual(kept);
    }
  });

  it("carries the prior lectures' glossaries, oldest first and deduplicated", async () => {
    const dir = await lecture("context-prior");
    const priorIndex: TermIndex = {
      schema: "terms/1",
      lectureId: "2026-09-08-lec04",
      course: "TDL",
      generated: "2026-09-08T20:00:00.000-04:00",
      pages: [],
      glossary: [
        {
          id: "t-radius",
          term: "certified radius",
          aliases: ["radius"],
          kind: "metric",
          definition: "x".repeat(PRIOR_DEFINITION_MAX + 40),
          intuition: "dropped from the compacted form",
          inThisCourse: "",
          pages: [4],
        },
        {
          id: "t-radius",
          term: "certified radius (again)",
          aliases: [],
          kind: "metric",
          definition: "the duplicate that must not win",
          intuition: "",
          inThisCourse: "",
          pages: [9],
        },
      ],
    };
    const prior = path.join(root, "2026-09-08-lec04");
    await mkdir(prior, { recursive: true });
    await writeFile(path.join(prior, "terms.json"), JSON.stringify(priorIndex));

    const { context, warnings } = await termsContext(dir, "1-2");
    expect(warnings).toEqual([]);
    expect(context.priorGlossary).toEqual([
      {
        id: "t-radius",
        term: "certified radius",
        aliases: ["radius"],
        definition: "x".repeat(PRIOR_DEFINITION_MAX),
      },
    ]);
    await rm(prior, { recursive: true, force: true });
  });

  it("warns, and carries on, when a prior lecture has no term index", async () => {
    const dir = await lecture("context-no-prior");
    const { context, warnings } = await termsContext(dir, "1-2");
    expect(context.priorGlossary).toEqual([]);
    expect(warnings.join("\n")).toContain("2026-09-08-lec04");
    expect(warnings.join("\n")).toContain("skipped");
  });
});

describe("merge terms", () => {
  it("merges the hand-written batches into a valid terms.json", async () => {
    const dir = await lecture("merge-ok", "complete");
    const result = await mergeTerms(dir);

    expect(result.sources).toEqual(["batch-01.json", "batch-02.json"]);
    expect(result.file).toBe(path.join(dir, "terms.json"));

    const written = await readJson<TermIndex>(result.file);
    expect(validateFile(written).ok).toBe(true);
    expect(written.lectureId).toBe("2026-09-15-lec05");
    expect(written.course).toBe("TDL");
    expect(written.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);

    // The glossary spans both files and keeps one entry per id.
    const ids = written.glossary.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    const radius = written.glossary.find((g) => g.id === "t-certified-radius");
    expect(radius?.pages).toEqual([2, 3, 4, 6]);
    expect(radius?.aliases).toEqual(["radius", "certificate"]);

    const manifest = await readJson<{ status: { terms?: string } }>(path.join(dir, "lecture.json"));
    expect(manifest.status.terms).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const summary = summarizeMerge(result);
    expect(summary).toContain("6 pages, terms per page min 0");
    expect(summary).toContain("glossary 13 terms");
    expect(summary).toContain("pages with zero terms: 5");
  });

  it("writes the same bytes twice, apart from the timestamp", async () => {
    const dir = await lecture("merge-stable", "complete");
    const first = await mergeTerms(dir);
    const a = await readFile(first.file, "utf8");
    const second = await mergeTerms(dir);
    const b = await readFile(second.file, "utf8");
    const strip = (s: string): string => s.replace(/"generated": "[^"]+"/, "");
    expect(strip(a)).toBe(strip(b));
  });

  it("refuses a page delivered by two batches, naming the page and both files", async () => {
    const dir = await lecture("merge-dup", "duplicate");
    await expect(mergeTerms(dir)).rejects.toThrow(CliError);
    await expect(mergeTerms(dir)).rejects.toThrow(
      /page 3 appears in more than one partial: batch-01\.json, batch-02\.json/,
    );
  });

  it("refuses a deck with a hole in it, and names the pages", async () => {
    const dir = await lecture("merge-missing", "missing");
    await expect(mergeTerms(dir)).rejects.toThrow(/page\(s\) missing .*: 4, 5/s);
    await expect(mergeTerms(dir)).rejects.toThrow(/--allow-missing/);
  });

  it("fills the hole on --allow-missing and says which pages it filled", async () => {
    const dir = await lecture("merge-allow", "missing");
    const result = await mergeTerms(dir, { allowMissing: true });
    expect(result.filled).toEqual([4, 5]);
    expect(summarizeMerge(result)).toContain("filled with empty pages (--allow-missing): 4, 5");
    const written = await readJson<TermIndex>(result.file);
    expect(written.pages[3]).toEqual({
      page: 4,
      title: "",
      summary: "",
      terms: [],
      passages: [],
      asrBias: [],
    });
    expect(validateFile(written).ok).toBe(true);
  });

  it("names the file and the page of a page that does not validate", async () => {
    const dir = await lecture("merge-invalid", "invalid");
    const error = await mergeTerms(dir).catch((e: Error) => e);
    expect(error).toBeInstanceOf(CliError);
    const text = (error as Error).message;
    expect(text).toContain("batch-01.json page 2:");
    expect(text).toContain("terms.0.kind");
    expect(text).toContain("terms.1.confidence");
  });

  it("clamps an over-long asrBias and warns instead of failing", async () => {
    const dir = await lecture("merge-clamp");
    const partials = path.join(dir, PARTIAL_DIR);
    await mkdir(partials, { recursive: true });
    const pages = Array.from({ length: 6 }, (_, i) => ({
      page: i + 1,
      title: "",
      summary: "",
      terms: [],
      passages: [],
      asrBias: i === 0 ? Array.from({ length: 45 }, (_, n) => `term-${n}`) : [],
    }));
    await writeFile(path.join(partials, "batch-01.json"), JSON.stringify({ pages }));

    const result = await mergeTerms(dir);
    expect(result.clamped).toEqual([{ page: 1, from: 45, source: "batch-01.json" }]);
    expect(result.index.pages[0]?.asrBias).toHaveLength(40);
    expect(summarizeMerge(result)).toContain("clamped to 40");
  });

  it("rejects a partial that is not JSON, or has no pages array", async () => {
    const dir = await lecture("merge-junk");
    const partials = path.join(dir, PARTIAL_DIR);
    await mkdir(partials, { recursive: true });
    await writeFile(path.join(partials, "batch-01.json"), "{ nope");
    await expect(mergeTerms(dir)).rejects.toThrow(/batch-01\.json: not valid JSON/);

    await writeFile(path.join(partials, "batch-01.json"), JSON.stringify({ terms: [] }));
    await expect(mergeTerms(dir)).rejects.toThrow(/expected a "pages" array, got nothing/);
  });

  it("explains itself when there is nothing to merge", async () => {
    const dir = await lecture("merge-empty");
    await expect(mergeTerms(dir)).rejects.toThrow(/run the \/lecture-terms skill first/);
    await mkdir(path.join(dir, PARTIAL_DIR), { recursive: true });
    await expect(mergeTerms(dir)).rejects.toThrow(/holds no \.json files/);
  });

  it("deletes the partials on --clean", async () => {
    const dir = await lecture("merge-clean", "complete");
    const result = await mergeTerms(dir, { clean: true });
    expect(result.removed).toEqual(["batch-01.json", "batch-02.json"]);
    expect(summarizeMerge(result)).toContain("removed 2 partial(s)");
    await expect(readdir(path.join(dir, PARTIAL_DIR))).rejects.toThrow();
  });
});

describe("merge terms --check", () => {
  it("validates what is written so far and lists the pages still to come", async () => {
    const dir = await lecture("check-partial");
    await mkdir(path.join(dir, PARTIAL_DIR), { recursive: true });
    await cp(
      path.join(PARTIALS, "complete", "batch-01.json"),
      path.join(dir, PARTIAL_DIR, "batch-01.json"),
    );
    const result = await checkPartials(dir);
    expect(result.sources).toEqual(["batch-01.json"]);
    expect(result.uncovered).toEqual([4, 5, 6]);
    expect(summarizeCheck(result)).toContain("pages not written yet: 4, 5, 6");

    // Nothing was written: --check is safe to run mid-run.
    const report = await status(dir);
    expect(report.artifacts.find((a) => a.name === "terms.json")?.present).toBe(false);
  });

  it("still refuses a page two partials both claim", async () => {
    const dir = await lecture("check-dup", "duplicate");
    await expect(checkPartials(dir)).rejects.toThrow(/page 3 appears in more than one partial/);
  });

  it("still refuses a page that does not validate", async () => {
    const dir = await lecture("check-invalid", "invalid");
    await expect(checkPartials(dir)).rejects.toThrow(/batch-01\.json page 2:/);
  });
});

describe("bias", () => {
  it("derives a bias.json the schema and the spike both accept", async () => {
    const dir = await lecture("bias-ok", "complete");
    await mergeTerms(dir);
    const result = await bias(dir);

    expect(result.file).toBe(path.join(dir, "bias.json"));
    const written = await readJson<Record<string, unknown>>(result.file);
    expect(BiasTermsSchema.safeParse(written).success).toBe(true);
    expect(validateFile(written).ok).toBe(true);
    expect(written["deck"]).toBe("deck.pdf");
    expect(written["source"]).toBe("derived");
    // The shape spike/src/spike/schemas.py reads: one entry per page, "global".
    expect((written["pages"] as { page: number }[]).map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.isArray(written["global"])).toBe(true);

    expect(result.bias.pages[1]?.terms[0]).toBe("randomized smoothing");
    expect(result.bias.global[0]).toBe("certified radius");
    expect(summarizeBias(result)).toContain("source derived, 6 pages");
  });

  it("honours the caps", async () => {
    const dir = await lecture("bias-caps", "complete");
    await mergeTerms(dir);
    const result = await bias(dir, { maxPage: 3, maxGlobal: 4 });
    expect(Math.max(...result.bias.pages.map((p) => p.terms.length))).toBe(3);
    expect(result.bias.global).toHaveLength(4);
    await expect(bias(dir, { maxPage: 99 })).rejects.toThrow(/--max-page must be between/);
    await expect(bias(dir, { maxGlobal: 0 })).rejects.toThrow(/--max-global must be between/);
  });

  it("says what is missing when there is no term index", async () => {
    const dir = await lecture("bias-no-terms");
    await expect(bias(dir)).rejects.toThrow(/no terms\.json/);
  });
});

describe("status with a term index", () => {
  it("counts the terms and names the bias source", async () => {
    const dir = await lecture("status-terms", "complete");
    await mergeTerms(dir);
    await bias(dir);
    const text = renderStatus(await status(dir));
    expect(text).toMatch(/\+ terms\.json\s+present\s+6 pages, 17 terms, 13 in glossary, 1 page\(s\) with none/);
    expect(text).toMatch(/\+ bias\.json\s+present\s+source derived, 6 pages/);
    expect(text).toMatch(/terms {9}\d{4}-/);
  });

  it("says so when the files are there but unreadable", async () => {
    const dir = await lecture("status-broken");
    await writeFile(path.join(dir, "terms.json"), "{ nope");
    await writeFile(path.join(dir, "bias.json"), JSON.stringify({ deck: "other.pdf" }));
    const text = renderStatus(await status(dir));
    expect(text).toContain("unreadable");
    expect(text).toContain("invalid BiasTerms");
  });
});
