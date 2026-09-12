import fs from "node:fs/promises";
import path from "node:path";

import { expect, type Page } from "@playwright/test";

import type { Event, SpanIndex } from "@lecture/core";

import { appUrl, COURSE, lectureDir, REVIEW_COURSE, REVIEW_LECTURE } from "./paths.ts";

/** Wipe the writable state of a lecture folder, so a test starts from prepared. */
export async function resetLecture(lectureId: string): Promise<void> {
  await fs.rm(path.join(lectureDir(lectureId), "events.jsonl"), { force: true });
  await fs.rm(path.join(lectureDir(lectureId), ".lecture", "heartbeat.json"), { force: true });
}

export async function readEvents(lectureId: string): Promise<Event[]> {
  const file = path.join(lectureDir(lectureId), "events.jsonl");
  const text = await fs.readFile(file, "utf8").catch(() => "");
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Event);
}

export async function readSpans(lectureId: string): Promise<SpanIndex> {
  const file = path.join(lectureDir(lectureId), "spans.json");
  return JSON.parse(await fs.readFile(file, "utf8")) as SpanIndex;
}

export async function writeHeartbeat(lectureId: string, agoMs: number, elapsedS: number): Promise<void> {
  const dir = path.join(lectureDir(lectureId), ".lecture");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "heartbeat.json"),
    JSON.stringify({
      pid: 4242,
      startedWall: new Date(Date.now() - elapsedS * 1000).toISOString(),
      updatedWall: new Date(Date.now() - agoMs).toISOString(),
      elapsedS,
      rmsRecent: 0.031,
    }),
  );
}

export async function removeHeartbeat(lectureId: string): Promise<void> {
  await fs.rm(path.join(lectureDir(lectureId), ".lecture", "heartbeat.json"), { force: true });
}

export function strip(page: Page, key: string) {
  return page.locator(`[data-strip-item="${key}"]`);
}

export async function openLibrary(page: Page): Promise<void> {
  await page.goto(appUrl("/library"));
  await expect(page.getByTestId("lecture-row").first()).toBeVisible();
}

export async function openLecture(page: Page, lectureId: string): Promise<void> {
  await page.goto(appUrl(`/lecture/${COURSE}/${lectureId}`));
  await waitForSlide(page, 1);
}

/** Review mode on the recorded, noted lecture, on the page it starts at. */
export async function openReview(page: Page): Promise<void> {
  await page.goto(appUrl(`/review/${REVIEW_COURSE}/${REVIEW_LECTURE}`));
  await waitForSlide(page, 1);
}

/** The stage stamps the page number on the slide once it has finished drawing. */
export async function waitForSlide(page: Page, n: number): Promise<void> {
  await expect(page.getByTestId("slide")).toHaveAttribute("data-page", String(n));
  await expect(page.getByTestId("text-layer")).toHaveAttribute("data-page", String(n));
}

/** Step the library's roving cursor onto a given lecture row. */
export async function focusRow(page: Page, lectureId: string): Promise<void> {
  const rows = page.getByTestId("lecture-row");
  const ids = await rows.evaluateAll((els) =>
    els.map((el) => (el as HTMLElement).dataset["lecture"] ?? ""),
  );
  const index = ids.indexOf(lectureId);
  expect(index, `no row for ${lectureId}; found ${ids.join(", ")}`).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < index; i += 1) await page.keyboard.press("j");
  await expect(rows.nth(index)).toHaveAttribute("aria-current", "true");
}
