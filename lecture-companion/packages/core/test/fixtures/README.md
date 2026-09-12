# Span-pipeline fixtures

Two small PDFs, one from each of the two toolchains the deck pipeline has to
survive (architecture.md §2). They are committed so that `npm test` needs no
network, and their extraction hashes are asserted in `cli/test/determinism.test.ts`
so a pdf.js upgrade cannot silently change span ids (architecture.md §11).

## `latex-slides.pdf` — a real Beamer deck

- Source (pinned to the commit it was fetched at):
  <https://raw.githubusercontent.com/pmichaillat/latex-presentation/bbaebd6cfe945d950452e257a758e5747baddb38/presentation.pdf>
- Upstream project: <https://github.com/pmichaillat/latex-presentation>
  ("A LaTeX template for presentations", by Pascal Michaillat)
- License: MIT —
  <https://github.com/pmichaillat/latex-presentation/blob/bbaebd6cfe945d950452e257a758e5747baddb38/LICENSE.md>
  (© 2022–present Pascal Michaillat)
- Retrieved: 2026-09-12, at commit `bbaebd6cfe945d950452e257a758e5747baddb38`.
  Committed verbatim, unmodified.
- sha256: `e429297ca3e108a0d086c88b092f3a1a559eab59e05e8887d41a1de99da2542b`
- Size: 715 411 bytes. 40 pages, 1338 text items, 474 lines.
- Genuine pdfTeX/Beamer output, confirmed from the PDF's own metadata:
  `/Producer (pdfTeX-1.40.28)`, `/Creator (LaTeX with Beamer class)`,
  `/PTEX.Fullbanner (This is pdfTeX, Version 3.141592653-2.6-1.40.28 (TeX Live 2025…))`.
- What it exercises: math fragmented into one-character items (Roman, Greek,
  blackboard-bold and calligraphic runs, superscripts and radicals on their own
  baselines), `•` itemize markers, theorem and proposition environments, tables,
  figures, a bibliography frame, and one entirely blank frame.

## `html-slides.pdf` — an HTML/PowerPoint-style deck

- Generated here, not downloaded: `node cli/scripts/make-html-slides.mjs`
  (Playwright's Chromium printing a six-page 16:9 HTML deck).
- License: same as this repository; no third-party content.
- sha256: `4229166453f7cd67034b7eeb624bab22be938f37a612d5a51b4e22631edb1041`
- 6 pages, 61 text items. Each page exercises one thing:

  | page | what it tests |
  |------|---------------|
  | 1 | the `title` line kind |
  | 2 | bullets and sub-bullets, and the `bullet` line kind |
  | 3 | inline Unicode math (`σ²`, `Φ⁻¹`, `‖x′−x‖∞ ≤ ε`) staying on one line |
  | 4 | a two-column layout splitting into one line per column |
  | 5 | four text boxes in deliberately non-reading DOM order |
  | 6 | a 20-word paragraph wrapping to no more than three lines |

  Page 2 also produces `certi` + `fi` + `cation` as three items, which is how the
  "join without a space when the gap is small" rule gets tested on real output.

Regenerating the file changes its bytes and therefore the determinism hash in
`cli/test/determinism.test.ts`; update that constant in the same commit.

## Known limitations

Observed on these fixtures and accepted for now.

- **Multi-column frames come out row-major across the columns.** Ordering is
  purely geometric — top to bottom, then left to right — so on a frame with two
  or three side-by-side columns the lines interleave: the first line of every
  column, then the second line of every column, and so on, rather than one
  column read to the bottom before the next begins. Nothing here detects column
  boundaries. Line *grouping* is still correct (no line ever straddles the
  gutter); only the order of the lines reads oddly.
- **Whitespace-only items become empty lines.** An item whose `str` is `" "`
  is not an empty string, so it is not skipped, but its text collapses to `""`.
  42 of the LaTeX deck's 474 lines are of this kind. They are harmless — they
  carry real span ids and a real box — but a prompt that renders every line
  will see blanks.
- **`kind: "title"` is assigned even when a page has no heading.** The rule is
  "the topmost line whose font height is the largest on the page", so a page of
  uniform body text labels its first line a title.
