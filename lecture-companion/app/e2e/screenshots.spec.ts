import path from "node:path";

import { expect, test } from "@playwright/test";

import { openLecture, openLibrary, resetLecture, waitForSlide } from "./helpers.ts";
import { FIXTURE, LATEX, SCREENSHOTS } from "./paths.ts";

const shot = (name: string): string => path.join(SCREENSHOTS, `${name}.png`);

test.beforeEach(async () => {
  await resetLecture(FIXTURE);
  await resetLecture(LATEX);
});

test("8. screenshots of the four states", async ({ page }) => {
  // Library: light, a single column, no pills and no badges.
  await openLibrary(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: shot("library-light") });

  // Lecture mode, page 2, dark: the slide and a 28 px strip, nothing else.
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const stripBox = await page.getByTestId("status-strip").boundingBox();
  expect(stripBox?.height).toBe(28);
  await page.screenshot({ path: shot("lecture-dark-page2") });

  // The note field, mounted on `n` and gone when it commits.
  await page.keyboard.press("n");
  await page.keyboard.type("why not the tail bound");
  await expect(page.getByTestId("note-input")).toBeFocused();
  await page.screenshot({ path: shot("lecture-note-input") });
  await page.keyboard.press("Escape");

  // The keymap overlay.
  await page.keyboard.press("?");
  await expect(page.getByTestId("keymap-overlay")).toBeVisible();
  await page.screenshot({ path: shot("keymap-overlay") });
  await page.keyboard.press("Escape");
});
