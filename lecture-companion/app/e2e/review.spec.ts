import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { focusRow, openLibrary, openReview, waitForSlide } from "./helpers.ts";

import {
  appUrl,
  REVIEW_COURSE,
  REVIEW_LECTURE,
  SCRATCH_COURSE,
  SCREENSHOTS,
  VAULT,
} from "./paths.ts";

const shot = (name: string): string => path.join(SCREENSHOTS, `${name}.png`);

const notes = (page: Page): Locator => page.getByTestId("note-line");
const anchors = (page: Page): Locator => page.locator('[data-testid="anchor-box"]');
const anchorFor = (page: Page, line: number): Locator =>
  page.locator(`[data-testid="anchor-box"][data-line="${line}"]`);

/** Step to a page with the number-entry keys, the way the keymap says to. */
async function goToPage(page: Page, n: number): Promise<void> {
  await page.keyboard.press(String(n));
  await page.keyboard.press("Enter");
  await waitForSlide(page, n);
}

/** The roving focus starts off the rail, so `j` once lands on the first note. */
async function focusNote(page: Page, index: number): Promise<void> {
  for (let i = 0; i <= index; i += 1) await page.keyboard.press("j");
  await expect(notes(page).nth(index)).toHaveAttribute("data-focused", "yes");
}

async function background(locator: Locator): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** Let the 90 ms tint land before a screenshot, so no fill is caught halfway. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState === "finished" || animation.playState === "idle"),
  );
}

test("1. the library opens the noted lecture in review mode", async ({ page }) => {
  await openLibrary(page);

  const row = page.locator(`[data-lecture="${REVIEW_LECTURE}"]`);
  await expect(page.getByRole("heading", { name: REVIEW_COURSE })).toBeVisible();
  await expect(row).toContainText("Certified Defenses");
  // prepared, terms, recorded, transcribed, notes: the whole pipeline has run.
  await expect(row.locator("[data-pips]")).toHaveAttribute("data-pips", "11111");

  await focusRow(page, REVIEW_LECTURE);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/review/${REVIEW_COURSE}/${REVIEW_LECTURE}$`));
  await waitForSlide(page, 1);

  const header = page.getByTestId("review-header");
  await expect(header).toContainText("Lec 05");
  await expect(header).toContainText("Certified Defenses");
  await expect(header).toContainText(REVIEW_COURSE);
  await expect(page.getByTestId("review-counter")).toHaveText("1/6");
  // Light in review, as the mode's default (ui-direction.md §A).
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const headerBox = await header.boundingBox();
  expect(headerBox?.height).toBe(36);
  const railBox = await page.getByTestId("note-rail").boundingBox();
  expect(railBox?.width).toBe(580);
  const measure = await page.getByTestId("rail-measure").boundingBox();
  expect(measure?.width).toBe(526);
  // The dev adapter knows where the vault is, so `o` has a path to hand over.
  await expect(page.getByTestId("open-obsidian")).toBeVisible();
});

test("2. the rail lists the page's notes in order, and the slide only rests", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 2);

  await expect(notes(page)).toHaveCount(7);
  const ids = await notes(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset["note"] ?? ""),
  );
  expect(ids).toEqual(["n-2-1", "n-2-2", "n-2-3", "n-2-4", "n-2-5", "n-2-6", "n-2-7"]);

  // The fourth note is the one the student typed: italic, with the cyan rule.
  const student = notes(page).nth(3);
  await expect(student).toHaveAttribute("data-kind", "student");
  await expect(student).toContainText("slide says noise at prediction time");
  const style = await student.evaluate((el) => {
    const text = el.querySelector("p") as HTMLElement;
    const gutter = el.querySelector("span") as HTMLElement;
    return {
      fontStyle: getComputedStyle(text).fontStyle,
      gutter: getComputedStyle(gutter).backgroundColor,
      gutterWidth: getComputedStyle(gutter).width,
    };
  });
  expect(style.fontStyle).toBe("italic");
  expect(style.gutterWidth).toBe("2px");
  // --mine in the light theme, #17697c.
  expect(style.gutter).toBe("rgb(23, 105, 124)");

  // Generated and student notes share a text edge behind the 12 px gutter.
  const edges = await notes(page).evaluateAll((els) =>
    els.map((el) => {
      const body = el.children[1] as HTMLElement;
      return Math.round(body.getBoundingClientRect().left);
    }),
  );
  expect(new Set(edges).size).toBe(1);

  // Lines 0, 1, 2, 4, 5 and 6 carry notes; line 3 does not.
  await expect(anchors(page)).toHaveCount(6);
  await expect(anchorFor(page, 3)).toHaveCount(0);
  const states = await anchors(page).evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset["state"] ?? ""),
  );
  expect(new Set(states)).toEqual(new Set(["resting"]));
  const fills = await anchors(page).evaluateAll((els) =>
    els.map((el) => getComputedStyle(el).backgroundColor),
  );
  expect(new Set(fills)).toEqual(new Set([TRANSPARENT]));
  const underline = await anchors(page)
    .first()
    .evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(underline).toBe("1px");
});

test("3. the focused note is active, a hovered one is hover, and the two coexist", async ({
  page,
}) => {
  await openReview(page);
  await goToPage(page, 2);
  await focusNote(page, 3);

  // The student note cites lines 1 and 2.
  await expect(page.locator('[data-testid="anchor-box"][data-state="active"]')).toHaveCount(2);
  await expect(anchorFor(page, 1)).toHaveAttribute("data-ref", "n-2-4");
  await expect(anchorFor(page, 1)).toHaveAttribute("data-mine", "yes");
  await expect(anchorFor(page, 2)).toHaveAttribute("data-state", "active");
  // The first note cites lines 0 and 1; line 0 is its own and stays at rest.
  await expect(anchorFor(page, 0)).toHaveAttribute("data-state", "resting");

  await notes(page).first().hover();
  await expect(anchorFor(page, 0)).toHaveAttribute("data-state", "hover");
  // The tint is a 90 ms fade, so the fill is asserted once it has landed.
  await expect.poll(() => background(anchorFor(page, 0))).not.toBe(TRANSPARENT);
  // Line 1 is cited by both; the focused note is the stronger claim.
  await expect(anchorFor(page, 2)).toHaveAttribute("data-state", "active");
  await expect(notes(page).nth(3)).toHaveAttribute("data-focused", "yes");
});

test("4. hovering a slide line tints the notes that cite it", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 2);

  // "Take a majority vote over the noisy copies" is line 4, and the note about
  // the hundred thousand noisy copies is the only one that cites it.
  const line = anchorFor(page, 4);
  const box = await line.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);

  await expect(line).toHaveAttribute("data-state", "hover");
  const linked = notes(page).nth(2);
  await expect(linked).toContainText("hundred thousand");
  await expect(linked).toHaveAttribute("data-linked", "yes");
  // --accent in the light theme, #b0700f, once the 90 ms tint has landed.
  await expect
    .poll(() =>
      linked.evaluate(
        (el) => getComputedStyle(el.querySelector("span") as HTMLElement).backgroundColor,
      ),
    )
    .toBe("rgb(176, 112, 15)");
  await expect(notes(page).first()).toHaveAttribute("data-linked", "no");
});

test("5. Enter toggles a question's answer and a generated note's quote", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 3);

  // The student question is the second note on this page, and it was answered.
  const question = notes(page).nth(1);
  await expect(question).toContainText("why Phi inverse and not a tail bound?");
  await question.evaluate((el) => (el as HTMLElement).focus());
  const answer = question.getByTestId("note-answer");
  await expect(answer).toBeVisible();
  await expect(answer).toContainText("answered");
  await expect(answer).toContainText("Neyman-Pearson");

  await page.keyboard.press("Enter");
  await expect(answer).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(question.getByTestId("note-answer")).toBeVisible();

  const generated = notes(page).first();
  await generated.evaluate((el) => (el as HTMLElement).focus());
  await expect(generated.getByTestId("note-quote")).toHaveCount(0);
  await page.keyboard.press("Enter");
  await expect(generated.getByTestId("note-quote")).toBeVisible();

  // Confidence is a word in the meta line, never a coloured pill.
  const hedged = notes(page).nth(8);
  await expect(hedged.getByTestId("note-confidence")).toHaveText("confidence medium");
  const colour = await hedged
    .getByTestId("note-confidence")
    .evaluate((el) => getComputedStyle(el).color);
  // --ink-muted in the light theme, #616b75.
  expect(colour).toBe("rgb(97, 107, 117)");
});

test("6. ] and [ skip the page with no notes", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 4);

  // The open questions belong to the lecture, so they are listed once, after
  // the notes of the last page that has any.
  await expect(page.getByTestId("open-questions")).toHaveCount(0);

  await page.keyboard.press("]");
  await waitForSlide(page, 6);
  await expect(page.getByTestId("review-counter")).toHaveText("6/6");
  const questions = page.getByTestId("open-questions");
  await expect(questions).toContainText("Open questions");
  await expect(questions).toContainText("does a certified radius survive fine tuning");
  await expect(questions).toContainText("slide 4");

  await page.keyboard.press("[");
  await waitForSlide(page, 4);

  // The ends are walls: there is nothing before page 1's notes.
  await goToPage(page, 1);
  await page.keyboard.press("[");
  await waitForSlide(page, 1);
});

test("7. g opens the glossary, Enter explains an entry, and the panel is remembered", async ({
  page,
}) => {
  await openReview(page);
  await goToPage(page, 2);

  await expect(page.getByTestId("glossary-entries")).toHaveCount(0);
  await page.keyboard.press("g");
  const entries = page.getByTestId("glossary-entry");
  await expect(entries).toHaveCount(6);
  await expect(entries.first()).toContainText("randomized smoothing");

  // Hovering an entry tints the lines the term appears on.
  await entries.nth(3).hover();
  await expect(anchorFor(page, 4)).toHaveAttribute("data-state", "hover");

  await entries.first().evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("lookup-card")).toBeVisible();
  await expect(page.getByTestId("lookup-phrase")).toHaveText("randomized smoothing");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-card")).toHaveCount(0);

  // Open across a reload, closed across the next one.
  await page.reload();
  await waitForSlide(page, 2);
  await expect(page.getByTestId("glossary-entries")).toBeVisible();
  await page.keyboard.press("g");
  await expect(page.getByTestId("glossary-entries")).toHaveCount(0);
  await page.reload();
  await waitForSlide(page, 2);
  await expect(page.getByTestId("glossary-entries")).toHaveCount(0);
});

test("8. a page with no notes says so", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 5);

  await expect(notes(page)).toHaveCount(0);
  await expect(page.getByTestId("rail-empty")).toHaveText("No notes on this slide");
  await expect(anchors(page)).toHaveCount(0);

  // The app never writes Markdown; Option+E says which command does.
  await page.keyboard.press("Alt+e");
  await expect(page.getByTestId("review-message")).toHaveText(
    "run lecture export-md in a terminal",
  );
});

test("9. selecting a phrase and pressing e explains it in review too", async ({ page }) => {
  await openReview(page);
  await goToPage(page, 3);

  await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="text-layer"]');
    if (!layer) throw new Error("no text layer");
    const span = Array.from(layer.querySelectorAll("span")).find((s) =>
      (s.textContent ?? "").includes("Noise scale"),
    );
    if (!span) throw new Error("no span to select");
    const node = span.firstChild as Text;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.setBaseAndExtent(node, 0, node, node.length);
  });
  await page.keyboard.press("e");

  await expect(page.getByTestId("lookup-card")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("lookup-card")).toHaveCount(0);
});

test("11. Option+2 and Option+1 swap the same lecture between the two modes", async ({ page }) => {
  await openReview(page);
  await page.keyboard.press("Alt+Digit1");
  await expect(page).toHaveURL(new RegExp(`#/lecture/${REVIEW_COURSE}/${REVIEW_LECTURE}$`));
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.keyboard.press("Alt+Digit2");
  await expect(page).toHaveURL(new RegExp(`#/review/${REVIEW_COURSE}/${REVIEW_LECTURE}$`));
  await expect(page.getByTestId("review-header")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("10. the screenshots, and a deck printed on black", async ({ page, context }) => {
  await openReview(page);
  await goToPage(page, 2);
  await focusNote(page, 3);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await settled(page);
  await page.screenshot({ path: shot("review-page2") });

  await goToPage(page, 3);
  const question = notes(page).nth(1);
  await question.evaluate((el) => (el as HTMLElement).focus());
  await expect(question.getByTestId("note-answer")).toBeVisible();
  await settled(page);
  await page.screenshot({ path: shot("review-page3-answer") });

  // With a generated note focused, so the set of three shows both an amber
  // active reference and the student's cyan one.
  const spoken = notes(page).first();
  await spoken.evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press("g");
  await expect(page.getByTestId("glossary-entries")).toBeVisible();
  await expect(page.locator('[data-testid="anchor-box"][data-state="active"]')).toHaveCount(1);
  await settled(page);
  await page.screenshot({ path: shot("review-glossary-open") });

  /*
   * The dark-deck rule. Chrome prints a black page to a one-page PDF, the CLI
   * prepares it into a scratch course the Library skips, and review mode's
   * luminance sample is what stamps the stage.
   */
  const dir = path.join(VAULT, SCRATCH_COURSE, "dark-deck");
  await fs.rm(dir, { recursive: true, force: true });
  const pdfFile = path.join(VAULT, SCRATCH_COURSE, "dark.pdf");
  await fs.mkdir(path.dirname(pdfFile), { recursive: true });
  // A second page does the printing, so the page under test is never navigated
  // away from the app.
  const printer = await context.newPage();
  await printer.setContent(
    `<body style="margin:0;background:#0b0d10;color:#d7dce2;font:28px system-ui">
       <div style="padding:60px">A deck printed on black</div>
     </body>`,
  );
  await printer.pdf({
    path: pdfFile,
    width: "10in",
    height: "5.625in",
    printBackground: true,
    pageRanges: "1",
  });
  await printer.close();
  execFileSync(
    process.execPath,
    [
      path.resolve(VAULT, "..", "..", "..", "cli", "bin", "lecture.mjs"),
      "prepare",
      dir,
      "--deck",
      pdfFile,
      "--course",
      "SCRATCH",
      "--id",
      "dark-deck",
    ],
    { stdio: "inherit" },
  );

  await page.goto(appUrl(`/review/${SCRATCH_COURSE}/dark-deck`));
  await waitForSlide(page, 1);
  await expect(page.getByTestId("slide")).toHaveAttribute("data-deck", "dark");

  // And the light fixture deck is still light. It reopens on the page it was
  // last left on, which is why this does not wait for page 1.
  await page.goto(appUrl(`/review/${REVIEW_COURSE}/${REVIEW_LECTURE}`));
  await expect(page.getByTestId("slide")).toHaveAttribute("data-ready", "yes");
  await expect(page.getByTestId("slide")).toHaveAttribute("data-deck", "light");

  await fs.rm(path.join(VAULT, SCRATCH_COURSE), { recursive: true, force: true });
});
