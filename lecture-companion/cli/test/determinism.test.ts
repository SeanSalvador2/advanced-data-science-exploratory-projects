import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildSpanIndex } from "../src/commands/extract-spans.js";
import { canonicalSpanText, hashSpanIndex } from "../src/commands/hash-spans.js";
import { PDFJS_INSTALLED_VERSION } from "../src/pdf.js";
import { canonicalJson } from "../src/util.js";
import { EXPECTED_SPAN_HASH, FIXTURES } from "./fixtures.js";

describe("pdfjs-dist pin", () => {
  it("is exactly the version the contracts name", () => {
    expect(PDFJS_INSTALLED_VERSION).toBe("6.3.289");
  });
});

describe.each(["html", "latex"] as const)("%s fixture", (name) => {
  it("hashes to the committed value", async () => {
    const index = await buildSpanIndex(FIXTURES[name]);
    expect(hashSpanIndex(index)).toBe(EXPECTED_SPAN_HASH[name]);
  });

  it("extracts byte-identically twice in a row", async () => {
    const a = await buildSpanIndex(FIXTURES[name]);
    const b = await buildSpanIndex(FIXTURES[name]);
    expect(canonicalJson(b)).toBe(canonicalJson(a));
    expect(canonicalSpanText(b)).toBe(canonicalSpanText(a));
  });

  it("stamps the installed pdf.js version and the fixed extract options", async () => {
    const index = await buildSpanIndex(FIXTURES[name]);
    expect(index.pdfjsVersion).toBe("6.3.289");
    expect(index.extractOptions).toEqual({
      includeMarkedContent: false,
      disableNormalization: false,
    });
  });

  it("numbers span ids densely, empty strings included", async () => {
    const index = await buildSpanIndex(FIXTURES[name]);
    for (const page of index.pages) {
      expect(page.items.map((i) => i.id)).toEqual(page.items.map((_, i) => i));
    }
    // Both fixtures do contain empty-string items; if they stopped containing
    // them the span-id contract would no longer be under test.
    const empties = index.pages.flatMap((p) => p.items.filter((i) => i.str === ""));
    expect(empties.length).toBeGreaterThan(0);
  });

  it("puts every non-empty item on exactly one line, and no empty one on any", async () => {
    const index = await buildSpanIndex(FIXTURES[name]);
    for (const page of index.pages) {
      const seen = page.lines.flatMap((l) => l.items);
      expect(new Set(seen).size).toBe(seen.length);
      const expected = page.items.filter((i) => i.str !== "").map((i) => i.id);
      expect([...seen].sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("rounds every number in the written JSON to 3 decimals", async () => {
    const index = await buildSpanIndex(FIXTURES[name]);
    const text = canonicalJson(index);
    const overlong = text.match(/-?\d+\.\d{4,}/g);
    expect(overlong).toBeNull();
  });
});

describe("temp-folder round trip", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "lecture-det-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("gives the same hash from a copied deck as from the fixture in place", async () => {
    const { prepare } = await import("../src/commands/prepare.js");
    const { hashSpans } = await import("../src/commands/hash-spans.js");
    const target = path.join(dir, "lec-html");
    await prepare(target, { deck: FIXTURES.html, course: "TEST", date: "2026-09-12" });
    expect(await hashSpans(target)).toBe(EXPECTED_SPAN_HASH.html);
  });
});
