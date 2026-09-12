import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { openLecture, waitForSlide } from "./helpers.ts";
import { appUrl, BASE_URL, FIXTURE, SCRATCH_COURSE, VAULT } from "./paths.ts";

const CLI = path.resolve(VAULT, "..", "..", "..", "cli", "bin", "lecture.mjs");

/** The two faces `tokens.css` declares, with the weights the app asks for. */
const FACES = [
  '400 15px "Atkinson Hyperlegible Next"',
  '600 14px "Atkinson Hyperlegible Next"',
  'italic 400 15px "Atkinson Hyperlegible Next"',
  '400 12px "Atkinson Hyperlegible Mono"',
];

/**
 * Anything the page may legitimately ask for that is not an http URL: pdf.js
 * hands its worker a blob, and an inlined asset is a data URL. Neither leaves
 * the machine.
 */
function offOrigin(url: string): boolean {
  if (url.startsWith("data:") || url.startsWith("blob:")) return false;
  return !url.startsWith(BASE_URL);
}

test("16. the Atkinson faces are loaded, and nothing is fetched off this origin", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));

  await openLecture(page, FIXTURE);
  // The note field and the lookup card are where the italic and the heavier
  // weights are actually used, so ask for every declared face by hand rather
  // than hoping this screen happens to paint one.
  await page.evaluate(async (faces) => {
    await Promise.all(faces.map((face) => document.fonts.load(face)));
    await document.fonts.ready;
  }, FACES);

  for (const face of FACES) {
    expect(await page.evaluate((f) => document.fonts.check(f), face), face).toBe(true);
  }
  // The plain form the brief names, once the faces are in.
  expect(await page.evaluate(() => document.fonts.check('15px "Atkinson Hyperlegible Next"'))).toBe(
    true,
  );

  // And the body really is rendering in it, not in the fallback stack.
  const family = await page.evaluate(() => {
    const el = document.body;
    return getComputedStyle(el).fontFamily;
  });
  expect(family).toContain("Atkinson Hyperlegible Next");

  const strays = requests.filter(offOrigin);
  expect(strays, `requests left the origin: ${strays.join(", ")}`).toEqual([]);
  // A sanity check on the check itself: the fonts were served, from here.
  expect(requests.filter((u) => u.includes("/fonts/")).length).toBeGreaterThan(0);
});

/**
 * A one-page PDF that names Helvetica and embeds nothing.
 *
 * Hand-written rather than produced by a library, because every PDF producer
 * available here embeds a subset of whatever it draws with, and an embedded
 * font is exactly the case this test is not about. Offsets are computed as the
 * objects are appended, so the xref table is real and pdf.js parses it without
 * having to rebuild it.
 */
function helveticaPdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] " +
      "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const stream = "BT /F1 36 Tf 60 300 Td (Certified radius) Tj ET\n";
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const startxref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

test("17. a deck whose Helvetica is not embedded renders from pdf.js's own font data", async ({
  page,
}) => {
  const dir = path.join(VAULT, SCRATCH_COURSE, "helvetica");
  const pdfFile = path.join(VAULT, SCRATCH_COURSE, "helvetica.pdf");
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(pdfFile), { recursive: true });
  await fs.writeFile(pdfFile, helveticaPdf());
  execFileSync(
    process.execPath,
    [CLI, "prepare", dir, "--deck", pdfFile, "--course", "SCRATCH", "--id", "helvetica"],
    { stdio: "inherit" },
  );

  const complaints: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (/font data|standard_?fonts|standardFontDataUrl|fetchStandardFontData/iu.test(text)) {
      complaints.push(text);
    }
  });

  await page.goto(appUrl(`/lecture/${SCRATCH_COURSE}/helvetica`));
  await waitForSlide(page, 1);

  // Ink on the page: the canvas is white except where the glyphs are, so a
  // count of non-white pixels is the difference between "drawn" and "blank".
  const inked = await page.getByTestId("slide").evaluate((el) => {
    const canvas = el.querySelector("canvas");
    if (!canvas) return -1;
    const ctx = canvas.getContext("2d");
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let dark = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 128) dark += 1;
    }
    return dark;
  });
  expect(inked).toBeGreaterThan(200);

  // pdf.js found its own standard_fonts folder, so nothing was substituted.
  expect(complaints, complaints.join("\n")).toEqual([]);
});
