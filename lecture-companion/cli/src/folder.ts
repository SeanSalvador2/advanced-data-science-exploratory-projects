import { readFile } from "node:fs/promises";
import path from "node:path";
import { LectureManifestSchema, formatIssues, toIssues, type LectureManifest } from "@lecture/core";
import { CliError, exists, writeAtomic, canonicalJson } from "./util.js";

/** Every artefact name the lecture folder contract fixes (architecture.md §3). */
export const FILES = {
  manifest: "lecture.json",
  deck: "deck.pdf",
  spans: "spans.json",
  pages: "pages",
  terms: "terms.json",
  bias: "bias.json",
  audio: "audio.wav",
  recording: "recording.json",
  heartbeat: path.join(".lecture", "heartbeat.json"),
  events: "events.jsonl",
  transcript: "transcript.json",
  notes: "notes.json",
} as const;

export function at(dir: string, name: string): string {
  return path.join(dir, name);
}

export function pagePng(dir: string, page: number): string {
  return path.join(dir, FILES.pages, `p${String(page).padStart(3, "0")}.png`);
}

export async function readManifest(dir: string): Promise<LectureManifest> {
  const file = at(dir, FILES.manifest);
  if (!(await exists(file))) {
    throw new CliError(`no ${FILES.manifest} in ${dir} — run \`lecture prepare\` first`);
  }
  const parsed = LectureManifestSchema.safeParse(JSON.parse(await readFile(file, "utf8")));
  if (!parsed.success) {
    throw new CliError(`${file} is not a valid LectureManifest:\n${formatIssues(toIssues(parsed.error))}`);
  }
  return parsed.data;
}

export async function writeManifest(dir: string, manifest: LectureManifest): Promise<void> {
  await writeAtomic(at(dir, FILES.manifest), canonicalJson(manifest));
}
