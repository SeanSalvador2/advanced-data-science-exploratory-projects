import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { COURSE, FIXTURE, LATEX, SCREENSHOTS, VAULT } from "./paths.ts";

const MONOREPO = path.resolve(VAULT, "..", "..", "..");
const CLI = path.join(MONOREPO, "cli", "bin", "lecture.mjs");

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

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}

/** Rebuild a prepared lecture folder with the CLI when it is not already there. */
function prepare(target: string, pdf: string, lectureId: string): void {
  execFileSync(
    process.execPath,
    [CLI, "prepare", target, "--deck", pdf, "--course", COURSE, "--id", lectureId],
    { stdio: "inherit", cwd: MONOREPO },
  );
}

/**
 * Build the vault the dev middleware serves: one course, `TEST`, holding
 * copies of the two prepared fixture lectures. Copies, not the originals, so a
 * test run never writes into `/tmp/lec-*` and the next run starts clean.
 */
export default async function globalSetup(): Promise<void> {
  await fs.rm(VAULT, { recursive: true, force: true });
  await fs.mkdir(path.join(VAULT, COURSE), { recursive: true });
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
}
