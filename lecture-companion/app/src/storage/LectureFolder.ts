/**
 * The storage adapter contract, architecture.md §8, plus `name` and
 * `subfolder` so the Library can walk `<vault>/<course>/<lectureId>/`.
 *
 * Two implementations exist: `FsaLectureFolder` (File System Access API, the
 * only one that ships) and `DevLectureFolder` (a Vite dev-server middleware,
 * used solely so this container can drive the app headlessly).
 *
 * `name` arguments may contain forward slashes (`.lecture/heartbeat.json`);
 * every implementation walks the segments itself. They are always relative to
 * this folder and may never contain `..`.
 */
export interface LectureFolder {
  /** The folder's own name, not its path. */
  readonly name: string;
  readJson<T>(name: string): Promise<T | null>;
  readBinary(name: string): Promise<ArrayBuffer>;
  /** Buffered by the caller; see `EventBuffer`. Creates the file if absent. */
  appendLines(name: string, lines: string[]): Promise<void>;
  /** Write through a temporary name so a watcher never sees a half file. */
  writeAtomic(name: string, text: string): Promise<void>;
  /** Every entry of this folder, files and directories alike, unsorted. */
  list(): Promise<string[]>;
  /** Fires after the named file changes. Returns an unsubscribe function. */
  watch(name: string, cb: () => void): () => void;
  /** The child directory, or null when it is missing or is a file. */
  subfolder(path: string): Promise<LectureFolder | null>;
}

/** Split a relative path into segments, rejecting escapes. */
export function splitPath(name: string): string[] {
  const parts = name.split("/").filter((p) => p.length > 0 && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error(`path escapes the lecture folder: ${name}`);
  }
  if (parts.length === 0) throw new Error("empty path");
  return parts;
}

/** How often the fallback watcher restats a file (phase-2-research.md §4). */
export const POLL_INTERVAL_MS = 3000;
