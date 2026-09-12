import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { escapeInline, lectureMarkdownStats, mmss, renderLectureMarkdown, yamlScalar } from "../src/index.js";
import type { LectureManifest, LectureNotes, RenderLectureMarkdownInput } from "../src/index.js";
import { MANIFEST, NOTES, SPANS, TERMS } from "./fixtures/export/input.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, "fixtures", "export", "expected.md");

function input(overrides: Partial<RenderLectureMarkdownInput> = {}): RenderLectureMarkdownInput {
  return {
    manifest: MANIFEST,
    notes: NOTES,
    terms: TERMS,
    spans: SPANS,
    options: { quotes: false },
    ...overrides,
  };
}

describe("mmss", () => {
  it("is mm:ss with hours rolled into the minutes", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(5)).toBe("00:05");
    expect(mmss(830)).toBe("13:50");
    expect(mmss(4512.9)).toBe("75:12");
    expect(mmss(-3)).toBe("00:00");
  });
});

describe("escapeInline and yamlScalar", () => {
  it("guards only what can break the page", () => {
    expect(escapeInline("plain σ² text_with_underscores")).toBe("plain σ² text_with_underscores");
    expect(escapeInline("radii [[like this]] reported")).toBe("radii [[like this]\\] reported");
    expect(escapeInline("# not a heading")).toBe("\\# not a heading");
    expect(escapeInline(" folded\n  onto one line ")).toBe("folded onto one line");
  });

  it("quotes a YAML scalar only when it needs it", () => {
    expect(yamlScalar("TDL")).toBe("TDL");
    expect(yamlScalar("Certified Defenses")).toBe("Certified Defenses");
    expect(yamlScalar("Lecture 5: the certificate")).toBe('"Lecture 5: the certificate"');
    expect(yamlScalar("")).toBe('""');
  });
});

describe("renderLectureMarkdown", () => {
  it("matches the committed golden file", async () => {
    expect(renderLectureMarkdown(input())).toBe(await readFile(GOLDEN, "utf8"));
  });

  it("builds the selection link from the first and last item of the noted lines", () => {
    // Page 2 line 1 starts at item 3; line 2 ends at item 5, whose string is 29
    // characters long (architecture.md §4.8).
    expect(renderLectureMarkdown(input())).toContain("[[deck.pdf#page=2&selection=3,0,5,29|slide]]");
  });

  it("falls back to a page link when there are no spans", () => {
    const md = renderLectureMarkdown(input({ spans: null }));
    expect(md).not.toContain("selection=");
    expect(md).toContain("- The noise scale is chosen once, at training time, and never touched again at certification time. [[deck.pdf#page=2]] `13:50`");
  });

  it("prefixes student notes with me: and nests the answer with its own time", () => {
    const md = renderLectureMarkdown(input());
    expect(md).toContain("- **me:** why Phi inverse and not a tail bound?");
    expect(md).toContain(
      "  - answered: Neyman-Pearson makes the worst case a half space, so the distance is exact. `14:32`",
    );
  });

  it("omits quotes by default and nests them under --quotes, generated notes only", () => {
    expect(renderLectureMarkdown(input())).not.toContain("  - > ");
    const quoted = renderLectureMarkdown(input({ options: { quotes: true } }));
    expect(quoted).toContain('  - > "you pick sigma once and you live with it"');
    // The student note carries no quote, so it gains no nested line.
    expect(quoted.split("\n").filter((l) => l.startsWith("  - > "))).toHaveLength(2);
  });

  it("skips a page with neither notes nor terms and keeps one with only terms", () => {
    const md = renderLectureMarkdown(input());
    expect(md).toContain("## Slide 1: Certified Defenses  [[deck.pdf#page=1]]");
    expect(md).not.toContain("## Slide 3");
    expect(lectureMarkdownStats(input())).toMatchObject({ sections: 2, noteLines: 3, termLines: 2, skippedPages: [3] });
  });

  it("rolls an hour into the minutes and escapes ]] and a leading #", () => {
    const md = renderLectureMarkdown(input());
    expect(md).toContain("- \\# radii written [[like this]\\] are the ones the paper reports `75:12`");
  });

  it("ends in exactly one newline, with no trailing whitespace and no double blank line", () => {
    const md = renderLectureMarkdown(input());
    expect(md.endsWith("\n")).toBe(true);
    expect(md.endsWith("\n\n")).toBe(false);
    expect(md).not.toMatch(/[ \t]+\n/u);
    expect(md).not.toContain("\n\n\n");
  });

  it("is deterministic", () => {
    expect(renderLectureMarkdown(input())).toBe(renderLectureMarkdown(input()));
  });

  it("falls back through the heading: number, then title, then lecture id", () => {
    const bare = (m: Partial<LectureManifest>, n: Partial<LectureNotes> = {}): string =>
      renderLectureMarkdown(input({ manifest: { ...MANIFEST, ...m }, notes: { ...NOTES, ...n }, terms: null }))
        .split("\n")
        .find((l) => l.startsWith("# ")) as string;
    expect(renderLectureMarkdown(input()).split("\n")).toContain("# Lecture 05: Certified Defenses");
    expect(bare({ number: undefined, title: "Certified Defenses" })).toBe("# Certified Defenses");
    expect(bare({ number: undefined, title: undefined })).toBe("# 2026-09-15-lec05");
  });

  it("drops the Terms blocks when there is no term index", () => {
    const md = renderLectureMarkdown(input({ terms: null }));
    expect(md).not.toContain("Terms on this slide");
    expect(md).not.toContain("## Slide 1");
    expect(md).toContain("## Slide 2: The certificate");
  });
});
