import path from "node:path";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openLecture, openLibrary, openReview, resetLecture, waitForSlide } from "./helpers.ts";
import { FIXTURE, REVIEW_COURSE, REVIEW_LECTURE, SCREENSHOTS } from "./paths.ts";

const shot = (name: string): string => path.join(SCREENSHOTS, `${name}.png`);

const palette = (page: Page): Locator => page.getByTestId("command-palette");
const input = (page: Page): Locator => page.getByTestId("palette-input");
const rows = (page: Page): Locator => page.getByTestId("palette-row");
const active = (page: Page): Locator => page.locator('[data-testid="palette-row"][data-active="true"]');

test.beforeEach(async () => {
  await resetLecture(FIXTURE);
});

/**
 * Ctrl+K, which is the binding this container can actually press. Cmd+K is the
 * same code path — the router takes either modifier — but a Mac keyboard is not
 * something Playwright on Linux can produce, so that half stays a manual check.
 */
async function openPalette(page: Page): Promise<void> {
  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
}

test("18. Ctrl+K opens the palette anywhere, and Esc closes it", async ({ page }) => {
  await openLibrary(page);
  await openPalette(page);
  await expect(rows(page).first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();

  // And in lecture mode, where it matters most.
  await openLecture(page, FIXTURE);
  await openPalette(page);
  await expect(palette(page)).toBeVisible();
});

test("19. Option+K is the fallback, and a second Cmd+K closes what it opened", async ({ page }) => {
  await openLibrary(page);
  await page.keyboard.press("Alt+k");
  await expect(palette(page)).toBeVisible();

  await page.keyboard.press("Control+k");
  await expect(palette(page)).toBeHidden();
});

test("20. the palette is 520 px wide, 96 px down, and puts no scrim over the slide", async ({
  page,
}) => {
  await openLecture(page, FIXTURE);
  await openPalette(page);

  const box = await palette(page).boundingBox();
  expect(box).not.toBeNull();
  expect(Math.round(box!.width)).toBe(520);
  expect(Math.round(box!.y)).toBe(96);

  const style = await palette(page).evaluate((el) => {
    const own = getComputedStyle(el);
    const backdrop = getComputedStyle(el, "::backdrop");
    return {
      radius: own.borderTopLeftRadius,
      border: own.borderTopWidth,
      backdrop: backdrop.backgroundColor,
    };
  });
  expect(style.radius).toBe("8px");
  expect(style.border).toBe("1px");
  // No scrim: nothing may dim the professor's slide (anti-pattern 1).
  expect(style.backdrop).toBe("rgba(0, 0, 0, 0)");

  // The slide is still there, and still lit.
  await expect(page.getByTestId("slide")).toBeVisible();
  await page.screenshot({ path: shot("command-palette") });
});

test("21. bare letters type into the palette instead of firing shortcuts", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await openPalette(page);

  // `n`, `t`, `e` and `g` are all bound outside the palette. Inside it they are
  // just letters, because the FSM is in `palette` mode (ui-direction.md §D).
  await page.keyboard.type("next");
  await expect(input(page)).toHaveValue("next");
  await expect(page.getByTestId("note-input")).toHaveCount(0);
  await expect(page.getByTestId("lookup-card")).toHaveCount(0);

  await expect(rows(page).first()).toContainText("Next slide");
});

test("22. the arrows move the highlight and Enter runs the command", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await waitForSlide(page, 1);
  await openPalette(page);

  await page.keyboard.type("slide");
  await expect(active(page)).toContainText("Next slide");
  await page.keyboard.press("ArrowDown");
  await expect(active(page)).toContainText("Previous slide");
  await page.keyboard.press("ArrowUp");
  await expect(active(page)).toContainText("Next slide");

  await page.keyboard.press("Enter");
  // Running a command closes the palette, and the key it stands for happens.
  await expect(palette(page)).toBeHidden();
  await waitForSlide(page, 2);
});

test("23. the filter is a subsequence match on words", async ({ page }) => {
  await openLibrary(page);
  await openPalette(page);

  // Initials of two separate words.
  await page.keyboard.type("swth");
  await expect(rows(page).first()).toContainText("Switch theme");

  await input(page).fill("rescan");
  await expect(rows(page).first()).toContainText("Rescan library");

  await input(page).fill("zzqq");
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByTestId("palette-empty")).toBeVisible();
});

test("24. Switch theme from the palette flips the theme", async ({ page }) => {
  await openReview(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await openPalette(page);
  await input(page).fill("switch theme");
  await page.keyboard.press("Enter");

  await expect(palette(page)).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("25. the palette lists the vault's lectures and opens one by its title", async ({ page }) => {
  await openLibrary(page);
  await openPalette(page);

  await input(page).fill("open review certified");
  await expect(rows(page).first()).toContainText("Open review Certified Defenses");
  await expect(rows(page).first()).toContainText(REVIEW_LECTURE);

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/review/${REVIEW_COURSE}/${REVIEW_LECTURE}$`));
  await expect(page.getByTestId("review-header")).toBeVisible();
});

test("26. opening the palette closes an open lookup card first", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);

  await page.evaluate(() => {
    const layer = document.querySelector('[data-testid="text-layer"]');
    const spans = Array.from(layer?.querySelectorAll("span") ?? []);
    const span = spans.find((s) => (s.textContent ?? "").includes("majority"));
    const node = span?.firstChild as Text;
    window.getSelection()?.setBaseAndExtent(node, 0, node, node.length);
  });
  await page.keyboard.press("e");
  await expect(page.getByTestId("lookup-card")).toBeVisible();

  await openPalette(page);
  // The card is gone, so the palette cannot be sitting on top of the line it
  // was anchored to.
  await expect(page.getByTestId("lookup-card")).toHaveCount(0);
});

test("27. Type a note from the palette leaves the keyboard in the note field", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await openPalette(page);
  await input(page).fill("type a note");
  await page.keyboard.press("Enter");

  await expect(palette(page)).toBeHidden();
  await expect(page.getByTestId("note-input")).toBeFocused();

  // The letters are the note's, not the keymap's: `t` must not start a term
  // cycle and `e` must not open a card behind the field.
  await page.keyboard.type("tell me about the tail bound");
  await expect(page.getByTestId("note-input")).toHaveValue("tell me about the tail bound");
  await expect(page.getByTestId("lookup-card")).toHaveCount(0);
});

test("28. Show keys from the palette opens the keymap, and it lists every group", async ({
  page,
}) => {
  await openLibrary(page);
  await openPalette(page);
  await input(page).fill("show keys");
  await page.keyboard.press("Enter");

  const overlay = page.getByTestId("keymap-overlay");
  await expect(overlay).toBeVisible();
  for (const group of [
    "Slides",
    "Notes",
    "Lookup",
    "Review",
    "Library",
    "Command palette",
    "Everywhere",
  ]) {
    await expect(overlay).toContainText(group);
  }
  await expect(overlay).toContainText("Cmd+K, Ctrl+K");
  await expect(overlay).not.toContainText("Not built yet");

  // Esc still leaves the FSM where the overlay's own mode says it is: a bare
  // letter works again straight afterwards.
  await page.keyboard.press("Escape");
  await expect(overlay).toBeHidden();
  await page.keyboard.press("r");
  await expect(page.getByTestId("lecture-row").first()).toBeVisible();
});
