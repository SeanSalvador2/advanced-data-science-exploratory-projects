import { expect, test } from "@playwright/test";

import { focusRow, openLibrary, readSpans, resetLecture, waitForSlide } from "./helpers.ts";
import { FIXTURE, LATEX } from "./paths.ts";

test.beforeEach(async () => {
  await resetLecture(FIXTURE);
  await resetLecture(LATEX);
});

test("1. the library lists both prepared lectures under course TEST with their pips", async ({
  page,
}) => {
  await openLibrary(page);

  // Scoped to TEST on purpose: the vault also holds course TDL's recorded and
  // noted lecture, which review mode is tested against.
  const rows = page.locator('[data-testid="lecture-row"][data-course="TEST"]');
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "TEST" })).toBeVisible();
  await expect(page.getByText("2 lectures")).toBeVisible();

  // `lecture prepare` ran, `/lecture-terms` ran; nothing else has.
  await expect(page.locator(`[data-lecture="${FIXTURE}"] [data-pips]`)).toHaveAttribute(
    "data-pips",
    "11000",
  );
  // The 40-page deck has only been prepared.
  await expect(page.locator(`[data-lecture="${LATEX}"] [data-pips]`)).toHaveAttribute(
    "data-pips",
    "10000",
  );

  await expect(page.locator(`[data-lecture="${FIXTURE}"]`)).toContainText("6 slides");
  await expect(page.locator(`[data-lecture="${LATEX}"]`)).toContainText("40 slides");

  // Nothing coloured: pips are shapes, not badges (anti-pattern 4).
  const pipColours = await page
    .locator(`[data-lecture="${FIXTURE}"] [data-pip]`)
    .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(new Set(pipColours).size).toBeLessThanOrEqual(2);
});

test("2. Enter opens lecture mode on page 1, with a canvas and a text layer that matches spans.json", async ({
  page,
}) => {
  await openLibrary(page);
  await focusRow(page, FIXTURE);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(new RegExp(`#/lecture/TEST/${FIXTURE}$`));
  await waitForSlide(page, 1);

  const canvas = page.locator('[data-testid="slide"] canvas');
  await expect(canvas).toBeVisible();
  const size = await canvas.evaluate((el) => ({
    width: (el as HTMLCanvasElement).width,
    height: (el as HTMLCanvasElement).height,
  }));
  expect(size.width).toBeGreaterThan(100);
  expect(size.height).toBeGreaterThan(100);

  const spans = await readSpans(FIXTURE);
  const page1 = spans.pages.find((p) => p.page === 1);
  expect(page1).toBeDefined();
  const nonEmpty = (page1?.items ?? []).filter((item) => item.str !== "").length;
  expect(nonEmpty).toBeGreaterThan(0);

  // pdf.js appends a span only for items that carry text.
  await expect(page.locator('[data-testid="text-layer"] > span')).toHaveCount(nonEmpty);
  // And `textDivs` holds one entry per string-bearing item, empty ones too:
  // that index is the span id in spans.json.
  await expect(page.getByTestId("text-layer")).toHaveAttribute(
    "data-item-count",
    String(page1?.items.length ?? 0),
  );

  await expect(page.locator('[data-strip-item="slide"]')).toHaveText("1/6");
});
