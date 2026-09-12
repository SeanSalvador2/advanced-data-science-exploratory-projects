import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";

import {
  POLL_INTERVAL_MS,
  splitPath,
  type LectureFolder,
} from "./LectureFolder.ts";

const ROOT_KEY = "lecture-vault-root";

/** True when this browser can be asked for a directory at all. */
export function fsaSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

/**
 * Ask for the vault folder. Chrome remembers `id` per origin, so the picker
 * reopens where it was last left. `mode: "readwrite"` is asked for up front:
 * the app writes `events.jsonl` into whichever lecture is opened.
 */
export async function pickRootHandle(): Promise<FileSystemDirectoryHandle> {
  const handle = await showDirectoryPicker({ mode: "readwrite", id: "lecture-vault" });
  await idbSet(ROOT_KEY, handle);
  return handle;
}

/** The handle remembered from a previous visit, if any. */
export async function storedRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(ROOT_KEY);
  return handle ?? null;
}

export async function forgetRootHandle(): Promise<void> {
  await idbDel(ROOT_KEY);
}

export type VaultPermission = "granted" | "prompt" | "denied";

export async function queryVaultPermission(
  handle: FileSystemDirectoryHandle,
): Promise<VaultPermission> {
  const state = await handle.queryPermission?.({ mode: "readwrite" });
  return (state ?? "prompt") as VaultPermission;
}

/** Must be called from inside a user gesture, or Chrome rejects it. */
export async function requestVaultPermission(
  handle: FileSystemDirectoryHandle,
): Promise<VaultPermission> {
  const state = await handle.requestPermission?.({ mode: "readwrite" });
  return (state ?? "prompt") as VaultPermission;
}

function isNotFound(err: unknown): boolean {
  return err instanceof DOMException && err.name === "NotFoundError";
}

/**
 * A lecture folder backed by the File System Access API.
 *
 * Two facts from phase-2-research.md §4 shape the write paths: a writable
 * stream only reaches disk on `close()`, and appending rewrites the whole file
 * unless `keepExistingData` is set and the cursor is moved past the end. So
 * `appendLines` opens with `keepExistingData`, seeks to the current size, and
 * closes once — callers buffer above this (see `EventBuffer`).
 */
export class FsaLectureFolder implements LectureFolder {
  readonly name: string;
  readonly #dir: FileSystemDirectoryHandle;

  constructor(dir: FileSystemDirectoryHandle, name?: string) {
    this.#dir = dir;
    this.name = name ?? dir.name;
  }

  get handle(): FileSystemDirectoryHandle {
    return this.#dir;
  }

  /** Walk `a/b/c.json` down to the directory holding `c.json`. */
  async #resolveParent(
    name: string,
    create: boolean,
  ): Promise<{ dir: FileSystemDirectoryHandle; leaf: string } | null> {
    const parts = splitPath(name);
    const leaf = parts.pop() as string;
    let dir = this.#dir;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part, { create });
      } catch (err) {
        if (!create && isNotFound(err)) return null;
        throw err;
      }
    }
    return { dir, leaf };
  }

  async #fileHandle(name: string, create: boolean): Promise<FileSystemFileHandle | null> {
    const parent = await this.#resolveParent(name, create);
    if (!parent) return null;
    try {
      return await parent.dir.getFileHandle(parent.leaf, { create });
    } catch (err) {
      if (!create && isNotFound(err)) return null;
      throw err;
    }
  }

  async readJson<T>(name: string): Promise<T | null> {
    const handle = await this.#fileHandle(name, false);
    if (!handle) return null;
    const text = await (await handle.getFile()).text();
    if (text.trim() === "") return null;
    return JSON.parse(text) as T;
  }

  async readBinary(name: string): Promise<ArrayBuffer> {
    const handle = await this.#fileHandle(name, false);
    if (!handle) throw new Error(`${this.name}/${name} is missing`);
    return (await handle.getFile()).arrayBuffer();
  }

  async appendLines(name: string, lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    const handle = await this.#fileHandle(name, true);
    if (!handle) throw new Error(`could not open ${this.name}/${name} for writing`);
    const size = (await handle.getFile()).size;
    const writable = await handle.createWritable({ keepExistingData: true });
    try {
      await writable.seek(size);
      await writable.write(lines.map((l) => `${l}\n`).join(""));
    } finally {
      await writable.close();
    }
  }

  /**
   * Temp-then-move, so Obsidian's watcher never indexes a half-written file.
   * `FileSystemFileHandle.move` is Chrome 113+; where it is missing the final
   * file is written directly *after* the temp write succeeded, which at least
   * proves the data and the quota were good, and the temp file is removed.
   */
  async writeAtomic(name: string, text: string): Promise<void> {
    const parent = await this.#resolveParent(name, true);
    if (!parent) throw new Error(`could not open ${this.name}/${name} for writing`);
    const tmpName = `${parent.leaf}.tmp`;
    const tmp = await parent.dir.getFileHandle(tmpName, { create: true });
    const writable = await tmp.createWritable();
    try {
      await writable.write(text);
    } finally {
      await writable.close();
    }
    if (typeof tmp.move === "function") {
      await tmp.move(parent.leaf);
      return;
    }
    const final = await parent.dir.getFileHandle(parent.leaf, { create: true });
    const finalWritable = await final.createWritable();
    try {
      await finalWritable.write(text);
    } finally {
      await finalWritable.close();
    }
    await parent.dir.removeEntry(tmpName).catch(() => undefined);
  }

  async list(): Promise<string[]> {
    const names: string[] = [];
    for await (const key of this.#dir.keys()) names.push(key);
    return names;
  }

  /**
   * `FileSystemObserver` where Chrome has it (133+), otherwise a 3 s poll of
   * `lastModified`. Either way the callback fires only on an actual change,
   * and a file that does not exist yet is watched for its appearance.
   */
  watch(name: string, cb: () => void): () => void {
    let stopped = false;
    const cleanups: Array<() => void> = [];

    if (typeof FileSystemObserver === "function") {
      const observer = new FileSystemObserver(() => {
        if (!stopped) cb();
      });
      // Observe the parent directory: the file may not exist yet, and an
      // appearance is exactly what the heartbeat watcher waits for.
      void (async () => {
        const parent = await this.#resolveParent(name, false).catch(() => null);
        if (stopped) return;
        const target = parent?.dir ?? this.#dir;
        await observer.observe(target, { recursive: true }).catch(() => undefined);
      })();
      cleanups.push(() => observer.disconnect());
      return () => {
        stopped = true;
        for (const c of cleanups) c();
      };
    }

    let last = -1;
    const tick = async (): Promise<void> => {
      const handle = await this.#fileHandle(name, false).catch(() => null);
      let stamp = -1;
      if (handle) {
        stamp = await handle
          .getFile()
          .then((f) => f.lastModified)
          .catch(() => -1);
      }
      if (stopped) return;
      if (last !== -1 && stamp !== last) cb();
      last = stamp;
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    cleanups.push(() => clearInterval(timer));
    return () => {
      stopped = true;
      for (const c of cleanups) c();
    };
  }

  async subfolder(path: string): Promise<LectureFolder | null> {
    const parts = splitPath(path);
    let dir = this.#dir;
    for (const part of parts) {
      try {
        dir = await dir.getDirectoryHandle(part);
      } catch (err) {
        // A file of that name, or nothing there at all.
        if (isNotFound(err) || (err instanceof DOMException && err.name === "TypeMismatchError")) {
          return null;
        }
        throw err;
      }
    }
    return new FsaLectureFolder(dir, parts[parts.length - 1] as string);
  }
}
