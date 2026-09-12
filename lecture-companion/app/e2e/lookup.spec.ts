import fs from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { openLecture, resetLecture, strip, waitForSlide } from "./helpers.ts";
import { COURSE, FIXTURE, lectureDir, NOINDEX, SCREENSHOTS, VAULT } from "./paths.ts";

const shot = (name: string): string => path.join(SCREENSHOTS, `${name}.png`);

const card = (page: Page) => page.getByTestId("lookup-card");
const phrase = (page: Page) => page.getByTestId("lookup-phrase");
const anchors = (page: Page) => page.locator('[data-testid="anchor-box"]');
const activeAnchors = (page: Page) => page.locator('[data-testid="anchor-box"][data-state="active"]');

/**
 * A copy of the prepared fixture with its term index taken away. It is built
 * here rather than in the global setup so the library listing, and the
 * screenshot of it, stay exactly as task 4 left them.
 */
test.beforeAll(async () => {
  const target = path.join(VAULT, COURSE, NOINDEX);
  await fs.rm(target, { recursive: true, force: true });
  await fs.cp(lectureDir(FIXTURE), target, { recursive: true });
  await fs.rm(path.join(target, "terms.json"), { force: true });
});

test.afterAll(async () => {
  await fs.rm(path.join(VAULT, COURSE, NOINDEX), { recursive: true, force: true });
});

test.beforeEach(async () => {
  await resetLecture(FIXTURE);
});

/**
 * Select from the first character of the first text-layer div containing
 * `from` to the end of the last div containing `to`, exactly as a drag across
 * the line would. `backwards` runs the range the other way, which is what a
 * right-to-left drag hands the app.
 */
async function selectLine(
  page: Page,
  from: string,
  to: string,
  options: { backwards?: boolean } = {},
): Promise<string> {
  return page.evaluate(
    ({ from: f, to: t, backwards }) => {
      const layer = document.querySelector('[data-testid="text-layer"]');
      if (!layer) throw new Error("no text layer");
      const spans = Array.from(layer.querySelectorAll("span"));
      const start = spans.find((s) => (s.textContent ?? "").includes(f));
      const end = [...spans].reverse().find((s) => (s.textContent ?? "").includes(t));
      if (!start || !end) throw new Error(`no divs for ${f} / ${t}`);
      const startNode = start.firstChild as Text;
      const endNode = end.firstChild as Text;
      const selection = window.getSelection();
      if (!selection) throw new Error("no selection object");
      selection.removeAllRanges();
      if (backwards) {
        selection.setBaseAndExtent(endNode, endNode.length, startNode, 0);
      } else {
        selection.setBaseAndExtent(startNode, 0, endNode, endNode.length);
      }
      return selection.toString();
    },
    { from, to, backwards: options.backwards === true },
  );
}

/** Wait for the one orchestrated 180 ms moment to finish, before a screenshot. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every((animation) => animation.playState === "finished" || animation.playState === "idle"),
  );
}

/** Every box the anchor layer is currently drawing, in viewport pixels. */
async function anchorBoxes(page: Page): Promise<Array<{ x: number; y: number; width: number }>> {
  return anchors(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width) };
    }),
  );
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("9. e on a selected line explains the term it names, anchored beside the line", async ({
  page,
}) => {
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);

  const selected = await selectLine(page, "majority", "copies");
  expect(selected).toContain("majority vote");

  await page.keyboard.press("e");
  await expect(card(page)).toBeVisible();
  await expect(phrase(page)).toHaveText("majority vote");
  await expect(card(page)).toContainText("The class predicted most often across the noisy copies");
  await expect(page.getByTestId("lookup-meta")).toContainText("slide 2");
  await expect(page.getByTestId("lookup-meta")).toContainText("esc close");

  // The line it explains is lit, and the card does not sit on top of it.
  await expect(activeAnchors(page)).toHaveCount(1);
  const anchorBox = await activeAnchors(page).first().boundingBox();
  const cardBox = await card(page).boundingBox();
  expect(anchorBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(intersects(anchorBox!, cardBox!)).toBe(false);
  // And there is a leader between the two, not a scrim over the slide.
  await expect(page.getByTestId("lookup-leader")).toBeVisible();

  await settled(page);
  await page.screenshot({ path: shot("lookup-card") });
});

test("10. a whole equation line explains as a passage whose chips switch the card", async ({
  page,
}) => {
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 3);

  await selectLine(page, "‖x′−x‖∞", "ε");
  await page.keyboard.press("e");

  await expect(card(page)).toHaveAttribute("data-kind", "passage");
  await expect(page.getByTestId("lookup-explanation")).toContainText("epsilon");
  await expect(page.getByTestId("lookup-chip")).toHaveText(["ell infinity norm", "epsilon"]);
  await settled(page);
  await page.screenshot({ path: shot("lookup-passage") });

  // Tab reaches the chips; the card does not trap focus and Esc still closes it.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-testid="lookup-chip"][data-term="t-epsilon"]')).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(card(page)).toHaveAttribute("data-kind", "term");
  await expect(phrase(page)).toHaveText("epsilon");
  await expect(card(page)).toContainText("perturbation budget");
});

test("11. t steps a cursor through the slide's terms and e opens the one it is on", async ({
  page,
}) => {
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);

  // Nothing selected and no cursor yet: `e` asks for a phrase, it does not guess.
  await page.keyboard.press("e");
  await expect(strip(page, "lookup")).toHaveText("select a phrase first");
  await expect(card(page)).toHaveCount(0);

  await page.keyboard.press("t");
  await expect(strip(page, "cursor")).toHaveText("term 1/6 randomized smoothing");
  const first = await anchorBoxes(page);
  expect(first.length).toBeGreaterThan(0);

  await page.keyboard.press("t");
  await expect(strip(page, "cursor")).toHaveText("term 2/6 Gaussian noise");
  const second = await anchorBoxes(page);
  expect(second).not.toEqual(first);

  await page.keyboard.press("t");
  await expect(strip(page, "cursor")).toHaveText("term 3/6 certification time");
  const third = await anchorBoxes(page);
  expect(third).not.toEqual(second);
  // Nothing is open yet: the cursor tints, it does not explain.
  await expect(card(page)).toHaveCount(0);
  await settled(page);
  await page.screenshot({ path: shot("lookup-cursor") });

  await page.keyboard.press("e");
  await expect(phrase(page)).toHaveText("certification time");

  // Esc pops one level at a time: the card, then the cursor.
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);
  await expect(strip(page, "cursor")).toHaveText("term 3/6 certification time");
  await page.keyboard.press("Escape");
  await expect(strip(page, "cursor")).toHaveCount(0);
  await expect(anchors(page)).toHaveCount(0);

  // Shift+T walks the other way, from nothing to the last term on the slide.
  await page.keyboard.press("Shift+T");
  await expect(strip(page, "cursor")).toHaveText("term 6/6 certified radius");
  // And Enter opens the cursored term just as `e` does.
  await page.keyboard.press("Enter");
  await expect(phrase(page)).toHaveText("certified radius");
});

test("12. an exact title match is a term card, and an unindexed page says so plainly", async ({
  page,
}) => {
  await openLecture(page, FIXTURE);

  await selectLine(page, "Certi", "ed Defenses");
  await page.keyboard.press("e");
  await expect(phrase(page)).toHaveText("certified defense");
  await expect(card(page)).toHaveAttribute("data-kind", "term");
  await page.keyboard.press("Escape");

  await page.keyboard.press("5");
  await page.keyboard.press("Enter");
  await waitForSlide(page, 5);

  await selectLine(page, "Bravo", "page.");
  await page.keyboard.press("e");
  await expect(card(page)).toHaveAttribute("data-kind", "summary");
  await expect(phrase(page)).toHaveText("Not in the index");
  await expect(card(page)).toContainText("A placeholder page");
});

test("13. a backwards selection reads the same as a forwards one", async ({ page }) => {
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);

  await selectLine(page, "majority", "copies");
  await page.keyboard.press("e");
  await expect(phrase(page)).toHaveText("majority vote");
  const forwards = await card(page).innerText();
  await page.keyboard.press("Escape");
  await expect(card(page)).toHaveCount(0);

  await selectLine(page, "majority", "copies", { backwards: true });
  await page.keyboard.press("e");
  await expect(phrase(page)).toHaveText("majority vote");
  expect(await card(page).innerText()).toBe(forwards);
});

test("14. a lecture with no term index says so and opens no card", async ({ page }) => {
  await openLecture(page, NOINDEX);
  await expect(strip(page, "index")).toHaveText("no index");

  await selectLine(page, "Certi", "ed Defenses");
  await page.keyboard.press("e");

  await expect(strip(page, "lookup")).toHaveText("no term index for this lecture");
  await expect(card(page)).toHaveCount(0);
});

test("15. reduced motion leaves no transform behind", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLecture(page, FIXTURE);
  await page.keyboard.press("ArrowRight");
  await waitForSlide(page, 2);

  await selectLine(page, "majority", "copies");
  await page.keyboard.press("e");
  await expect(card(page)).toBeVisible();

  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="lookup-card"]');
    return el !== null && el.getAnimations().every((a) => a.playState === "finished");
  });
  await expect(card(page)).toHaveCSS("transform", "none");
  await expect(card(page)).toHaveCSS("opacity", "1");
});
