#!/usr/bin/env node
/**
 * Regenerate `packages/core/test/fixtures/html-slides.pdf`.
 *
 * A six-page, 16:9 landscape deck printed by Playwright's Chromium. It is the
 * "HTML/PowerPoint-style" half of the fixture pair from architecture.md §2, and
 * each page exercises one thing the span pipeline has to get right:
 *
 *   1  title page                       — the "title" line-kind heuristic
 *   2  bullets with sub-bullets         — the "bullet" line-kind heuristic
 *   3  inline Unicode math              — math runs must stay on one line
 *   4  two-column layout                — the horizontal-gap split
 *   5  boxes in non-reading DOM order   — geometric sorting, not item order
 *   6  a 20-word paragraph              — wrapped prose must not over-split
 *
 * Fonts are pinned to DejaVu Sans so the glyph metrics, and therefore the
 * committed determinism hash, do not move with the container's font set.
 *
 * Usage: node cli/scripts/make-html-slides.mjs [outputPath]
 */
import { chromium } from "playwright";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = path.resolve(here, "../../packages/core/test/fixtures/html-slides.pdf");

const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Fixture deck</title>
<style>
  @page { size: ${SLIDE_W_IN}in ${SLIDE_H_IN}in; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "DejaVu Sans"; color: #14161a; background: #ffffff; }
  .slide {
    width: ${SLIDE_W_IN}in; height: ${SLIDE_H_IN}in;
    padding: 0.75in 0.9in;
    page-break-after: always; break-after: page;
    position: relative; overflow: hidden;
  }
  .slide:last-child { page-break-after: auto; break-after: auto; }
  h1 { font-size: 52px; margin: 0 0 18px 0; font-weight: bold; }
  h2 { font-size: 40px; margin: 0 0 28px 0; font-weight: bold; }
  .sub { font-size: 24px; color: #4a4f57; margin: 0; }
  /* Markers are written as literal characters, not list-style markers, because
     Chromium draws a CSS marker as a vector path with an empty text item, and
     real decks (Beamer, PowerPoint) put the glyph in the text run. */
  ul { list-style: none; font-size: 26px; line-height: 1.7; margin: 0; padding: 0; }
  ul ul { list-style: none; font-size: 22px; margin: 6px 0 0 0; padding-left: 34px; }
  .math { font-size: 30px; line-height: 2.0; margin: 0 0 14px 0; }
  .cols { display: flex; gap: 1.4in; font-size: 24px; line-height: 1.6; }
  .cols > div { width: 4.2in; }
  .cols h3 { font-size: 26px; margin: 0 0 10px 0; }
  .free { position: absolute; font-size: 28px; }
  p.para { font-size: 28px; line-height: 1.6; width: 8.2in; margin: 0; }
</style>
</head>
<body>

<section class="slide">
  <h1>Certified Defenses</h1>
  <p class="sub">Lecture 5 — fixture deck for the span pipeline</p>
</section>

<section class="slide">
  <h2>Randomized smoothing</h2>
  <ul>
    <li>&#8226; Add Gaussian noise at prediction time
      <ul>
        <li>&#9702; the noise level is chosen at training time</li>
        <li>&#9702; not at certification time</li>
      </ul>
    </li>
    <li>&#8226; Take a majority vote over the noisy copies</li>
    <li>&#8226; The vote margin becomes a radius
      <ul>
        <li>1) bigger margin, bigger certificate</li>
      </ul>
    </li>
  </ul>
</section>

<section class="slide">
  <h2>The certificate</h2>
  <p class="math">Noise scale &#963;&#178; controls the trade-off.</p>
  <p class="math">&#8214;x&#8242;&#8722;x&#8214;&#8734; &#8804; &#949;</p>
  <p class="math">Radius uses &#934;&#8315;&#185; of the vote probability.</p>
</section>

<section class="slide">
  <h2>Two views</h2>
  <div class="cols">
    <div>
      <h3>Empirical</h3>
      <p>Attack the model and report what survives. Cheap to run, easy to break later.</p>
    </div>
    <div>
      <h3>Certified</h3>
      <p>Prove a radius no attack can cross. Expensive, smaller numbers, but honest.</p>
    </div>
  </div>
</section>

<section class="slide">
  <div class="free" style="left: 0.9in; top: 5.4in;">Delta comes fourth on the page.</div>
  <div class="free" style="left: 0.9in; top: 2.4in;">Bravo comes second on the page.</div>
  <div class="free" style="left: 0.9in; top: 3.9in;">Charlie comes third on the page.</div>
  <div class="free" style="left: 0.9in; top: 0.9in;">Alpha comes first on the page.</div>
</section>

<section class="slide">
  <h2>Summary</h2>
  <!-- exactly 20 words: the fixture asserts that wrapped prose stays <= 3 lines -->
  <p class="para">Certified defenses trade accuracy for a guarantee that holds against every attack inside the radius, so the numbers look small.</p>
</section>

</body>
</html>`;

const out = path.resolve(process.argv[2] ?? DEFAULT_OUT);

/**
 * Prefer an explicit Chromium when one is provided. In this container the
 * preinstalled browser build is older than the `playwright` npm package, so the
 * package's default download path does not exist; `CHROMIUM_PATH`, or the
 * conventional `/opt/pw-browsers/chromium` symlink, points at the real binary.
 */
function chromiumPath() {
  const fromEnv = process.env.CHROMIUM_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const conventional = "/opt/pw-browsers/chromium";
  if (existsSync(conventional)) return conventional;
  return undefined;
}

const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
try {
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.pdf({
    path: out,
    width: `${SLIDE_W_IN}in`,
    height: `${SLIDE_H_IN}in`,
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
  });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
