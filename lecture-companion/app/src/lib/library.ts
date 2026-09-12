import { LectureManifestSchema, type LectureManifest } from "@lecture/core";

import type { LectureFolder } from "../storage/LectureFolder.ts";
import { ROOT_COURSE } from "../state/routes.ts";

/** The five steps a lecture folder passes through (architecture.md §9). */
export const PIP_STEPS = ["prepared", "terms", "recorded", "transcribed", "notes"] as const;
export type PipStep = (typeof PIP_STEPS)[number];

export interface LectureEntry {
  /** Route segment: a course folder name, or `.` for the one-level layout. */
  course: string;
  /** What the Library prints above the rows. */
  courseTitle: string;
  lectureId: string;
  manifest: LectureManifest;
  pips: Record<PipStep, boolean>;
  /** Enter opens Review when notes exist, Lecture mode when they do not. */
  hasNotes: boolean;
}

export interface CourseGroup {
  course: string;
  courseTitle: string;
  lectures: LectureEntry[];
}

/** The artefact each step leaves behind, for when its status stamp is missing. */
const PIP_FILES: Record<PipStep, string> = {
  prepared: "spans.json",
  terms: "terms.json",
  recorded: "audio.wav",
  transcribed: "transcript.json",
  notes: "notes.json",
};

/**
 * A step counts as done when `lecture.json` says so *or* its artefact is on
 * disk. Both are checked because the producers are three separate programs and
 * a hand-run step can leave the file without the stamp; the row should show
 * what is actually there.
 */
function pipsOf(manifest: LectureManifest, files: Set<string>): Record<PipStep, boolean> {
  const status = manifest.status;
  const out = {} as Record<PipStep, boolean>;
  for (const step of PIP_STEPS) {
    out[step] = Boolean(status[step]) || files.has(PIP_FILES[step]);
  }
  return out;
}

async function readManifest(folder: LectureFolder): Promise<LectureManifest | null> {
  const raw = await folder.readJson<unknown>("lecture.json").catch(() => null);
  if (raw === null) return null;
  const parsed = LectureManifestSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(`${folder.name}/lecture.json is not a valid manifest; skipping`);
    return null;
  }
  return parsed.data;
}

function entryOf(
  course: string,
  courseTitle: string,
  manifest: LectureManifest,
  files: Set<string>,
): LectureEntry {
  const pips = pipsOf(manifest, files);
  return {
    course,
    courseTitle,
    lectureId: manifest.lectureId,
    manifest,
    pips,
    hasNotes: pips.notes,
  };
}

/** Newest first, and within a date the higher lecture number first. */
function byRecency(a: LectureEntry, b: LectureEntry): number {
  if (a.manifest.date !== b.manifest.date) return a.manifest.date < b.manifest.date ? 1 : -1;
  const an = a.manifest.number ?? -1;
  const bn = b.manifest.number ?? -1;
  if (an !== bn) return bn - an;
  return a.lectureId < b.lectureId ? 1 : -1;
}

/**
 * Walk the vault for `<course>/<lectureId>/lecture.json`, grouped by the course
 * segment. A root that is itself a course folder — `<lectureId>/lecture.json`
 * one level down — is accepted too, so pointing the picker one level too deep
 * still works.
 */
export async function scanLibrary(root: LectureFolder): Promise<CourseGroup[]> {
  const names = (await root.list()).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const groups = new Map<string, CourseGroup>();

  const add = (entry: LectureEntry): void => {
    let group = groups.get(entry.course);
    if (!group) {
      group = { course: entry.course, courseTitle: entry.courseTitle, lectures: [] };
      groups.set(entry.course, group);
    }
    group.lectures.push(entry);
  };

  for (const name of names) {
    if (name.startsWith(".")) continue;
    const child = await root.subfolder(name).catch(() => null);
    if (!child) continue;

    // One level: the root is a course folder and `child` is a lecture.
    const childFiles = new Set(await child.list().catch(() => []));
    if (childFiles.has("lecture.json")) {
      const own = await readManifest(child);
      if (own) {
        add(entryOf(ROOT_COURSE, own.courseTitle ?? own.course, own, childFiles));
        continue;
      }
    }

    // Two levels: `child` is the course, its children are the lectures.
    for (const lectureName of [...childFiles].sort()) {
      if (lectureName.startsWith(".")) continue;
      const folder = await child.subfolder(lectureName).catch(() => null);
      if (!folder) continue;
      const files = new Set(await folder.list().catch(() => []));
      if (!files.has("lecture.json")) continue;
      const manifest = await readManifest(folder);
      if (!manifest) continue;
      add(entryOf(name, manifest.courseTitle ?? manifest.course, manifest, files));
    }
  }

  const out = [...groups.values()];
  for (const group of out) {
    group.lectures.sort(byRecency);
    const titled = group.lectures.find((l) => l.manifest.courseTitle);
    if (titled?.manifest.courseTitle) group.courseTitle = titled.manifest.courseTitle;
  }
  out.sort((a, b) => (a.courseTitle < b.courseTitle ? -1 : a.courseTitle > b.courseTitle ? 1 : 0));
  return out;
}

/** Every lecture in reading order, which is what j/k walks. */
export function flatten(groups: CourseGroup[]): LectureEntry[] {
  return groups.flatMap((g) => g.lectures);
}
