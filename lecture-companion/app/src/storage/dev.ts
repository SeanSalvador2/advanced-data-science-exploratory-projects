import {
  POLL_INTERVAL_MS,
  splitPath,
  type LectureFolder,
} from "./LectureFolder.ts";

/**
 * A lecture folder that talks to the Vite dev middleware in
 * `vite-plugin-dev-folder.ts`. It exists only so this container can drive the
 * app headlessly (architecture.md §11: the File System Access API cannot be
 * automated). Every import of this module is behind `import.meta.env.DEV`, so
 * the production bundle contains neither the code nor the URL prefix.
 */
const PREFIX = "/__lecture/";

interface StatResponse {
  exists: boolean;
  dir: boolean;
  size: number;
  lastModified: number;
}

interface ListResponse {
  entries: Array<{ name: string; dir: boolean }>;
}

function joinPath(base: string, name: string): string {
  const parts = splitPath(name);
  return base === "" ? parts.join("/") : `${base}/${parts.join("/")}`;
}

async function getJson<T>(op: string, rel: string): Promise<T> {
  const res = await fetch(`${PREFIX}${op}?path=${encodeURIComponent(rel)}`);
  if (!res.ok) throw new Error(`${op} ${rel} failed with ${res.status}`);
  return (await res.json()) as T;
}

async function post(op: string, rel: string, text: string): Promise<void> {
  const res = await fetch(`${PREFIX}${op}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: rel, text }),
  });
  if (!res.ok) throw new Error(`${op} ${rel} failed with ${res.status}`);
}

export class DevLectureFolder implements LectureFolder {
  readonly name: string;
  readonly #base: string;

  constructor(base = "", name?: string) {
    this.#base = base;
    this.name = name ?? (base === "" ? "vault" : (base.split("/").pop() as string));
  }

  async readJson<T>(name: string): Promise<T | null> {
    const rel = joinPath(this.#base, name);
    const res = await fetch(`${PREFIX}read?path=${encodeURIComponent(rel)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`read ${rel} failed with ${res.status}`);
    const text = await res.text();
    if (text.trim() === "") return null;
    return JSON.parse(text) as T;
  }

  async readBinary(name: string): Promise<ArrayBuffer> {
    const rel = joinPath(this.#base, name);
    const res = await fetch(`${PREFIX}read?path=${encodeURIComponent(rel)}`);
    if (!res.ok) throw new Error(`${rel} is missing`);
    return res.arrayBuffer();
  }

  async appendLines(name: string, lines: string[]): Promise<void> {
    if (lines.length === 0) return;
    await post("append", joinPath(this.#base, name), lines.map((l) => `${l}\n`).join(""));
  }

  async writeAtomic(name: string, text: string): Promise<void> {
    await post("writeAtomic", joinPath(this.#base, name), text);
  }

  async list(): Promise<string[]> {
    const { entries } = await getJson<ListResponse>("list", this.#base);
    return entries.map((e) => e.name);
  }

  /** No `FileSystemObserver` here; the dev bridge polls `stat` like the FSA fallback. */
  watch(name: string, cb: () => void): () => void {
    const rel = joinPath(this.#base, name);
    let stopped = false;
    let last: string | null = null;
    const tick = async (): Promise<void> => {
      const st = await getJson<StatResponse>("stat", rel).catch(() => null);
      if (stopped || !st) return;
      const stamp = st.exists ? `${st.lastModified}:${st.size}` : "absent";
      if (last !== null && stamp !== last) cb();
      last = stamp;
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  async subfolder(path: string): Promise<LectureFolder | null> {
    const rel = joinPath(this.#base, path);
    const st = await getJson<StatResponse>("stat", rel).catch(() => null);
    if (!st || !st.exists || !st.dir) return null;
    return new DevLectureFolder(rel, rel.split("/").pop() as string);
  }
}
