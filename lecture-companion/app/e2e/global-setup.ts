import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import {
  COURSE,
  FIXTURE,
  LATEX,
  REVIEW_COURSE,
  REVIEW_LECTURE,
  SCREENSHOTS,
  VAULT,
} from "./paths.ts";

const MONOREPO = path.resolve(VAULT, "..", "..", "..");
const CLI = path.join(MONOREPO, "cli", "bin", "lecture.mjs");
const NOTES_FIXTURE = path.join(MONOREPO, "cli", "test", "fixtures", "notes-lecture");

const SOURCES: Record<string, { dir: string; pdf: string }> = {
  [FIXTURE]: {
    dir: "/tmp/lec-fixture",
    pdf: path.join(MONOREPO, "packages", "core", "test", "fixtures", "html-slides.pdf"),
  },
  [LATEX]: {
    dir: "/tmp/lec-latex",
    pdf: path.join(MONOREPO, "packages", "core", "test", "fixtures", "latex-slides.pdf"),
  },
};

/** The lecture review mode is tested on: prepared, noted and exported. */
const REVIEW_SOURCE = "/tmp/lec-notes";
/** The five files `/lecture-notes` and the recorder leave behind. */
const NOTES_FILES = [
  "recording.json",
  "events.jsonl",
  "transcript.json",
  "terms.json",
  "notes.json",
];

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

function run(args: string[]): void {
  execFileSync(process.execPath, [CLI, ...args], { stdio: "inherit", cwd: MONOREPO });
}

/** Rebuild a prepared lecture folder with the CLI when it is not already there. */
function prepare(target: string, pdf: string, lectureId: string): void {
  run(["prepare", target, "--deck", pdf, "--course", COURSE, "--id", lectureId]);
}

/**
 * A whole lecture as it looks after the pipeline has run: `lecture prepare` on
 * the fixture deck, the recorder's and the two skills' artefacts copied in,
 * then `lecture export-md`.
 */
async function prepareReviewLecture(): Promise<void> {
  run([
    "prepare",
    REVIEW_SOURCE,
    "--deck",
    path.join(MONOREPO, "packages", "core", "test", "fixtures", "html-slides.pdf"),
    "--course",
    REVIEW_COURSE,
    "--id",
    REVIEW_LECTURE,
    "--date",
    "2026-09-15",
    "--number",
    "5",
    "--title",
    "Certified Defenses",
  ]);
  for (const file of NOTES_FILES) {
    await fs.copyFile(path.join(NOTES_FIXTURE, file), path.join(REVIEW_SOURCE, file));
  }
  run(["export-md", REVIEW_SOURCE]);
}

/**
 * The producers downstream of `prepare` each stamp their own step in the
 * manifest. The recorder and the transcriber did not run here — their output
 * was copied in from the fixture — so the stamps are written the same way, and
 * the Library's five pips then read as a finished lecture. This runs on the
 * vault copy, so it applies whether or not `/tmp` still had the build.
 */
async function stampProducers(dir: string): Promise<void> {
  const manifestFile = path.join(dir, "lecture.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as {
    status: Record<string, string>;
  };
  manifest.status["recorded"] = "2026-09-15T14:20:00.000-04:00";
  manifest.status["transcribed"] = "2026-09-15T15:02:00.000-04:00";
  manifest.status["notes"] = "2026-09-15T20:14:00.000-04:00";
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Build the vault the dev middleware serves: course `TEST`, holding copies of
 * the two prepared fixture lectures, and course `TDL`, holding the recorded and
 * noted lecture review mode reads. Copies, not the originals, so a test run
 * never writes into `/tmp/lec-*` and the next run starts clean.
 */
export default async function globalSetup(): Promise<void> {
  await fs.rm(VAULT, { recursive: true, force: true });
  await fs.mkdir(path.join(VAULT, COURSE), { recursive: true });
  await fs.mkdir(path.join(VAULT, REVIEW_COURSE), { recursive: true });
  await fs.mkdir(SCREENSHOTS, { recursive: true });

  for (const [lectureId, source] of Object.entries(SOURCES)) {
    if (!(await exists(path.join(source.dir, "lecture.json")))) {
      prepare(source.dir, source.pdf, lectureId);
    }
    const target = path.join(VAULT, COURSE, lectureId);
    await fs.cp(source.dir, target, { recursive: true });
    // A prepared folder should carry no events; the app creates the file.
    await fs.rm(path.join(target, "events.jsonl"), { force: true });
    await fs.rm(path.join(target, ".lecture", "heartbeat.json"), { force: true });
  }

  if (!(await exists(path.join(REVIEW_SOURCE, "notes.json")))) {
    await fs.rm(REVIEW_SOURCE, { recursive: true, force: true });
    await prepareReviewLecture();
  }
  const reviewTarget = path.join(VAULT, REVIEW_COURSE, REVIEW_LECTURE);
  await fs.cp(REVIEW_SOURCE, reviewTarget, { recursive: true });
  await stampProducers(reviewTarget);
}
