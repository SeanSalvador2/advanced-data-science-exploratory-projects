import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepare } from "../src/commands/prepare.js";
import { FIXTURES } from "./fixtures.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The hand-written half of the recorded-lecture fixture: a 20-minute
 * recording over the six pages of `html-slides.pdf`, with app slide events
 * (page 5 skipped, page 3 revisited), three typed notes, and a transcript of a
 * lecturer who riffs beyond the slides. `terms.json` is the one
 * `/lecture-terms` produced for the same deck.
 */
export const NOTES_FIXTURE = path.join(here, "fixtures", "notes-lecture");

export const NOTES_FIXTURE_FILES = [
  "recording.json",
  "events.jsonl",
  "transcript.json",
  "terms.json",
] as const;

export const NOTES_PARTIALS = path.join(here, "fixtures", "notes-partials");

/**
 * Prepare `dir` from the fixture deck and overlay the recorded-lecture files,
 * giving the folder a post-lecture step would see: prepared, recorded,
 * transcribed, term-indexed, not yet noted.
 */
export async function buildNotesLecture(dir: string): Promise<string> {
  await prepare(dir, {
    deck: FIXTURES.html,
    course: "TDL",
    id: "2026-09-15-lec05",
    date: "2026-09-15",
    number: 5,
    title: "Certified Defenses",
  });
  for (const name of NOTES_FIXTURE_FILES) {
    await cp(path.join(NOTES_FIXTURE, name), path.join(dir, name));
  }
  return dir;
}
