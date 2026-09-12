import { expect, test } from "@playwright/test";

import { IsoTimestampSchema } from "@lecture/core";

import {
  openLecture,
  readEvents,
  removeHeartbeat,
  resetLecture,
  strip,
  waitForSlide,
  writeHeartbeat,
} from "./helpers.ts";
import { FIXTURE, LATEX } from "./paths.ts";

test.beforeEach(async () => {
  await resetLecture(FIXTURE);
  await resetLecture(LATEX);
});

test("3. arrows move the deck and every landing is a slide event on disk", async ({ page }) => {
  await openLecture(page, FIXTURE);

  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 3);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 4);
  await page.keyboard.press("ArrowLeft");
  await waitForSlide(page, 3);

  await expect(strip(page, "slide")).toHaveText("3/6");

  await expect
    .poll(async () => (await readEvents(FIXTURE)).map((e) => e.slide), { timeout: 10_000 })
    .toEqual([1, 2, 3, 4, 3]);

  for (const event of await readEvents(FIXTURE)) {
    expect(event.type).toBe("slide");
    expect(event.source).toBe("app");
    expect(IsoTimestampSchema.safeParse(event.wall).success).toBe(true);
    expect(event.t).toBeUndefined();
  }
});

test("4. typing a number and Enter jumps to that slide", async ({ page }) => {
  await openLecture(page, LATEX);
  await expect(strip(page, "slide")).toHaveText("1/40");

  await page.keyboard.press("1");
  await expect(strip(page, "digits")).toHaveText("→ 1_");
  await page.keyboard.press("2");
  await expect(strip(page, "digits")).toHaveText("→ 12_");
  await page.keyboard.press("Enter");

  await waitForSlide(page, 12);
  await expect(strip(page, "slide")).toHaveText("12/40");
  await expect(strip(page, "digits")).toHaveCount(0);

  await expect
    .poll(async () => (await readEvents(LATEX)).map((e) => e.slide), { timeout: 10_000 })
    .toEqual([1, 12]);
});

test("5. n opens the note field, Enter commits, and a flush writes it", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await expect(strip(page, "notes")).toHaveText("0 notes");

  await page.keyboard.press("n");
  const input = page.getByTestId("note-input");
  await expect(input).toBeFocused();

  // Every letter goes to the input, `n` included: the mode decides, not the
  // active element (ui-direction.md §D).
  await page.keyboard.type("why not the tail bound");
  await expect(input).toHaveValue("why not the tail bound");
  await expect(page.getByTestId("slide")).toHaveAttribute("data-page", "1");

  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);
  await expect(strip(page, "notes")).toHaveText("1 notes");

  // Nothing is written per keystroke; the blur is what flushes it.
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));

  await expect
    .poll(async () => (await readEvents(FIXTURE)).filter((e) => e.type === "note"), {
      timeout: 10_000,
    })
    .toMatchObject([{ type: "note", text: "why not the tail bound", source: "app" }]);

  const note = (await readEvents(FIXTURE)).find((e) => e.type === "note");
  expect(IsoTimestampSchema.safeParse(note?.wall ?? "").success).toBe(true);
});

test("5b. Esc cancels the note and an empty note writes nothing", async ({ page }) => {
  await openLecture(page, FIXTURE);

  await page.keyboard.press("n");
  await page.keyboard.type("never mind");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("note-input")).toHaveCount(0);

  await page.keyboard.press("n");
  await page.keyboard.press("Enter");
  await expect(strip(page, "notes")).toHaveText("0 notes");

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.waitForTimeout(500);
  expect((await readEvents(FIXTURE)).filter((e) => e.type === "note")).toEqual([]);
});

test("6. the strip reads the recorder heartbeat, goes stale, and notices it is gone", async ({
  page,
}) => {
  await removeHeartbeat(FIXTURE);
  await openLecture(page, FIXTURE);
  await expect(strip(page, "recorder")).toHaveText("no recorder");

  await writeHeartbeat(FIXTURE, 500, 42);
  await expect(strip(page, "recorder")).toHaveText("rec 00:42", { timeout: 10_000 });

  await writeHeartbeat(FIXTURE, 14_000, 900);
  await expect(strip(page, "recorder")).toHaveText(/^rec stale 1[3-9]s$/, { timeout: 10_000 });
  // The stale colour is the only saturated pixel the strip ever shows.
  const colour = await strip(page, "recorder").evaluate((el) => getComputedStyle(el).color);
  expect(colour).not.toBe(
    await strip(page, "slide").evaluate((el) => getComputedStyle(el).color),
  );

  await removeHeartbeat(FIXTURE);
  await expect(strip(page, "recorder")).toHaveText("no recorder", { timeout: 10_000 });
});

test("7. ? opens the keymap overlay and Esc closes it", async ({ page }) => {
  await openLecture(page, FIXTURE);
  const overlay = page.getByTestId("keymap-overlay");
  await expect(overlay).toBeHidden();

  await page.keyboard.press("?");
  await expect(overlay).toBeVisible();
  await expect(overlay).toContainText("Next slide");
  await expect(overlay).toContainText("Option+T");

  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();

  // And the deck still answers the arrow keys afterwards.
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);
});

test("7b. the fixture without a term index says so, and e says nothing more", async ({ page }) => {
  await openLecture(page, LATEX);
  await expect(strip(page, "index")).toHaveText("no index");
  await page.keyboard.press("e");
  await expect(strip(page, "transient")).toHaveText("no index");
});
