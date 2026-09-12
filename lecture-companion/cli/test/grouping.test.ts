import { describe, expect, it } from "vitest";
import type { SpanIndex, SpanPage } from "@lecture/core";
import { buildSpanIndex } from "../src/commands/extract-spans.js";
import { FIXTURES } from "./fixtures.js";

let cached: SpanIndex | null = null;
async function htmlIndex(): Promise<SpanIndex> {
  cached ??= await buildSpanIndex(FIXTURES.html);
  return cached;
}

async function page(n: number): Promise<SpanPage> {
  const index = await htmlIndex();
  const p = index.pages[n - 1];
  if (p === undefined) throw new Error(`no page ${n}`);
  return p;
}

describe("html-slides.pdf line grouping", () => {
  it("has the six pages the generator writes", async () => {
    expect((await htmlIndex()).pages).toHaveLength(6);
  });

  it("reads the shuffled page in visual order, not DOM order", async () => {
    // Page 5's four boxes are written bottom-first in the HTML source.
    const p = await page(5);
    expect(p.lines.map((l) => l.text)).toEqual([
      "Alpha comes first on the page.",
      "Bravo comes second on the page.",
      "Charlie comes third on the page.",
      "Delta comes fourth on the page.",
    ]);
    // and the ids follow that order, top to bottom
    expect(p.lines.map((l) => l.id)).toEqual([0, 1, 2, 3]);
    const tops = p.lines.map((l) => l.box[1]);
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  });

  it("keeps a 20-word paragraph to at most three lines", async () => {
    const p = await page(6);
    const body = p.lines.filter((l) => l.kind !== "title");
    expect(body.length).toBeLessThanOrEqual(3);
    expect(body.map((l) => l.text).join(" ")).toBe(
      "Certified defenses trade accuracy for a guarantee that holds against " +
        "every attack inside the radius, so the numbers look small.",
    );
    expect(body.map((l) => l.text).join(" ").split(" ")).toHaveLength(20);
  });

  it("keeps the math run on one line", async () => {
    const p = await page(3);
    expect(p.lines.map((l) => l.text)).toContain("‖x′−x‖∞ ≤ ε");
    expect(p.lines.map((l) => l.text)).toContain("Noise scale σ² controls the trade-off.");
    expect(p.lines.map((l) => l.text)).toContain(
      "Radius uses Φ⁻¹ of the vote probability.",
    );
  });

  it("splits the two-column page into one line per column", async () => {
    const p = await page(4);
    const texts = p.lines.map((l) => l.text);
    expect(texts).toContain("Empirical");
    expect(texts).toContain("Certified");
    expect(texts).toContain("Attack the model and report");
    expect(texts).toContain("Prove a radius no attack can");
    // No line straddles the gutter.
    for (const line of p.lines) expect(line.text).not.toMatch(/Empirical\s*Certified/);
  });

  it("joins items split mid-word without inserting a space", async () => {
    // Chromium emits "not at certi" + "fi" + "cation time" as three items.
    const p = await page(2);
    expect(p.lines.map((l) => l.text)).toContain("◦ not at certification time");
    expect(p.lines.map((l) => l.text)).toContain("1) bigger margin, bigger certificate");
  });

  it("labels the deck's title and bullets", async () => {
    expect((await page(1)).lines[0]).toMatchObject({ text: "Certified Defenses", kind: "title" });
    const p2 = await page(2);
    expect(p2.lines[0]).toMatchObject({ text: "Randomized smoothing", kind: "title" });
    expect(p2.lines.slice(1).every((l) => l.kind === "bullet")).toBe(true);
  });

  it("keeps every line's box inside the page", async () => {
    for (const p of (await htmlIndex()).pages) {
      for (const line of p.lines) {
        expect(line.box[0]).toBeGreaterThanOrEqual(0);
        expect(line.box[1]).toBeGreaterThanOrEqual(0);
        expect(line.box[0] + line.box[2]).toBeLessThanOrEqual(p.width + 1);
        expect(line.box[1] + line.box[3]).toBeLessThanOrEqual(p.height + 1);
      }
    }
  });
});

describe("latex-slides.pdf line grouping", () => {
  let latex: SpanIndex | null = null;
  async function latexIndex(): Promise<SpanIndex> {
    latex ??= await buildSpanIndex(FIXTURES.latex);
    return latex;
  }

  it("groups a LaTeX deck into far fewer lines than items", async () => {
    const index = await latexIndex();
    expect(index.pages).toHaveLength(40);
    const items = index.pages.reduce((n, p) => n + p.items.length, 0);
    const lines = index.pages.reduce((n, p) => n + p.lines.length, 0);
    expect(items).toBe(1338);
    expect(lines).toBe(474);
    expect(items).toBeGreaterThan(lines * 2);
  });

  it("fires every line-kind heuristic somewhere on the deck", async () => {
    const index = await latexIndex();
    const kinds = new Set(index.pages.flatMap((p) => p.lines.map((l) => l.kind)));
    // LaTeX fragments formulae into single-character items, and Beamer marks
    // every itemize entry, so both heuristics have to earn their keep here.
    expect(kinds).toContain("math");
    expect(kinds).toContain("bullet");
    expect(kinds).toContain("title");
  });

  it("classifies the itemize markers on a bulleted frame", async () => {
    // Page 2 is the template's plain "generic slide" of top-level items.
    const p = (await latexIndex()).pages[1];
    expect(p?.lines[0]?.kind).toBe("title");
    const bullets = p?.lines.filter((l) => l.kind === "bullet") ?? [];
    expect(bullets.length).toBeGreaterThanOrEqual(4);
    for (const line of bullets) expect(line.text.startsWith("• ")).toBe(true);
  });
});
