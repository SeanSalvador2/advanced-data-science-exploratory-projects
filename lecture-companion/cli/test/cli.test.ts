import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateFile } from "@lecture/core";
import { prepare } from "../src/commands/prepare.js";
import { extractSpans } from "../src/commands/extract-spans.js";
import { renderPages } from "../src/commands/render-pages.js";
import { renderValidation, validateJsonFile } from "../src/commands/validate.js";
import { renderStatus, status } from "../src/commands/status.js";
import { CliError } from "../src/util.js";
import { FIXTURES } from "./fixtures.js";

let root = "";
let dir = "";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lecture-cli-"));
  dir = path.join(root, "2026-09-12-lec01");
  await prepare(dir, { deck: FIXTURES.html, course: "TEST", date: "2026-09-12", title: "Fixture" });
}, 120_000);

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("prepare", () => {
  it("writes the whole lecture folder", async () => {
    for (const name of ["deck.pdf", "lecture.json", "spans.json"]) {
      expect((await stat(path.join(dir, name))).size).toBeGreaterThan(0);
    }
    for (let n = 1; n <= 6; n += 1) {
      expect((await stat(path.join(dir, "pages", `p00${n}.png`))).size).toBeGreaterThan(0);
    }
  });

  it("writes a manifest that validates and names the folder", async () => {
    const manifest = JSON.parse(await readFile(path.join(dir, "lecture.json"), "utf8"));
    const result = validateFile(manifest);
    expect(result.ok).toBe(true);
    expect(manifest.lectureId).toBe("2026-09-12-lec01");
    expect(manifest.course).toBe("TEST");
    expect(manifest.date).toBe("2026-09-12");
    expect(manifest.title).toBe("Fixture");
    expect(manifest.deck.pages).toBe(6);
    expect(manifest.pdfjs.version).toBe("6.3.289");
    expect(manifest.status.prepared).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records the deck's sha256 in both the manifest and the span index", async () => {
    const manifest = JSON.parse(await readFile(path.join(dir, "lecture.json"), "utf8"));
    const spans = JSON.parse(await readFile(path.join(dir, "spans.json"), "utf8"));
    expect(spans.deckSha256).toBe(manifest.deck.sha256);
    expect(manifest.deck.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("summarises pages, items and lines per page", async () => {
    const fresh = path.join(root, "summary");
    const result = await prepare(fresh, { deck: FIXTURES.html, course: "TEST", date: "2026-09-12" });
    expect(result.summary).toMatch(/^6 pages, \d+ items, lines per page min \d+ \/ median [\d.]+ \/ max \d+$/);
  });

  it("refuses to overwrite a different deck unless forced", async () => {
    const clash = path.join(root, "clash");
    await prepare(clash, { deck: FIXTURES.html, course: "TEST", date: "2026-09-12" });
    await expect(
      prepare(clash, { deck: FIXTURES.latex, course: "TEST", date: "2026-09-12" }),
    ).rejects.toThrow(/different sha256/);

    const forced = await prepare(clash, {
      deck: FIXTURES.latex,
      course: "TEST",
      date: "2026-09-12",
      force: true,
    });
    expect(forced.manifest.deck.pages).toBe(40);
  }, 180_000);

  it("re-preparing with the same deck is allowed and idempotent", async () => {
    const again = await prepare(dir, {
      deck: FIXTURES.html,
      course: "TEST",
      date: "2026-09-12",
      title: "Fixture",
    });
    expect(again.manifest.deck.pages).toBe(6);
    expect(again.skipped).toBe(6); // pages already rendered
  });

  it("rejects a malformed date and a missing deck", async () => {
    await expect(
      prepare(path.join(root, "bad-date"), { deck: FIXTURES.html, course: "TEST", date: "12/09/2026" }),
    ).rejects.toThrow(CliError);
    await expect(
      prepare(path.join(root, "no-deck"), { deck: path.join(root, "nope.pdf"), course: "TEST" }),
    ).rejects.toThrow(/no such deck/);
  });

  it("stores prior lecture ids only when given", async () => {
    const withPrior = await prepare(path.join(root, "prior"), {
      deck: FIXTURES.html,
      course: "TEST",
      date: "2026-09-12",
      prior: ["lec03", "lec04"],
    });
    expect(withPrior.manifest.priorLectures).toEqual(["lec03", "lec04"]);
    const manifest = JSON.parse(await readFile(path.join(dir, "lecture.json"), "utf8"));
    expect(manifest.priorLectures).toBeUndefined();
  });
});

describe("extract-spans", () => {
  it("writes a spans.json that validates", async () => {
    const { index, file } = await extractSpans(dir);
    expect(file).toBe(path.join(dir, "spans.json"));
    expect(validateFile(JSON.parse(await readFile(file, "utf8"))).ok).toBe(true);
    expect(index.pages).toHaveLength(6);
  });

  it("fails clearly when there is no deck", async () => {
    await expect(extractSpans(root)).rejects.toThrow(/no deck\.pdf/);
  });
});

describe("render-pages", () => {
  it("skips existing pages and re-renders with --force", async () => {
    const skip = await renderPages(dir);
    expect(skip.written).toEqual([]);
    expect(skip.skipped).toHaveLength(6);

    const forced = await renderPages(dir, { force: true, scale: 0.5 });
    expect(forced.written).toHaveLength(6);
    expect(forced.scale).toBe(0.5);
  }, 120_000);

  it("rejects a non-positive scale", async () => {
    await expect(renderPages(dir, { scale: 0 })).rejects.toThrow(/--scale/);
  });
});

describe("validate", () => {
  it("accepts the folder's own artefacts", async () => {
    for (const name of ["lecture.json", "spans.json"]) {
      const file = path.join(dir, name);
      const result = await validateJsonFile(file);
      expect(result.ok, renderValidation(file, result)).toBe(true);
      expect(renderValidation(file, result)).toMatch(/^ok {2}/);
    }
  });

  it("reports readable errors for a bad document", async () => {
    const file = path.join(root, "broken.json");
    await writeFile(file, JSON.stringify({ schema: "spans/1", pages: [] }));
    const result = await validateJsonFile(file);
    expect(result.ok).toBe(false);
    const text = renderValidation(file, result);
    expect(text).toMatch(/^fail {2}/);
    expect(text).toContain("deckSha256");
  });

  it("names the schema it could not recognise", async () => {
    const file = path.join(root, "unknown.json");
    await writeFile(file, JSON.stringify({ schema: "spans/2" }));
    const result = await validateJsonFile(file);
    expect(result.ok).toBe(false);
    expect(renderValidation(file, result)).toContain('unknown schema "spans/2"');
  });

  it("refuses a file that is not JSON, and one that is not there", async () => {
    const file = path.join(root, "not.json");
    await writeFile(file, "{ nope");
    await expect(validateJsonFile(file)).rejects.toThrow(/not valid JSON/);
    await expect(validateJsonFile(path.join(root, "ghost.json"))).rejects.toThrow(/no such file/);
  });
});

describe("status", () => {
  it("reports the artefacts that exist and the ones that do not", async () => {
    const report = await status(dir);
    const present = new Map(report.artifacts.map((a) => [a.name, a.present]));
    expect(present.get("lecture.json")).toBe(true);
    expect(present.get("deck.pdf")).toBe(true);
    expect(present.get("spans.json")).toBe(true);
    expect(present.get("pages/")).toBe(true);
    expect(present.get("terms.json")).toBe(false);
    expect(present.get("transcript.json")).toBe(false);

    const text = renderStatus(report);
    expect(text).toContain("+ spans.json");
    expect(text).toContain("- terms.json");
    expect(text).toContain("6 png");
    expect(text).toMatch(/prepared {6}\d{4}-/);
    expect(text).toContain("terms         -");
  });

  it("survives a folder with no manifest", async () => {
    const empty = path.join(root, "empty");
    const report = await status(empty);
    expect(report.manifest).toBeNull();
    expect(renderStatus(report)).toContain("no readable lecture.json");
  });
});
