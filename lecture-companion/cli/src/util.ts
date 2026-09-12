import { createHash } from "node:crypto";
import { access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Round to 3 decimals and normalise -0, so JSON output is stable. */
export function round3(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? 0 : r;
}

/** Fixed-width rendering of a rounded number, used by the determinism hash. */
export function fixed3(n: number): string {
  return round3(n).toFixed(3);
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write via `<name>.tmp` then rename, so a watcher (Obsidian, the app) never
 * sees a half-written file — architecture.md §3.
 */
export async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/**
 * `JSON.stringify` with every number rounded to 3 decimals. Key order is the
 * insertion order of the objects the commands build, which is fixed in code, so
 * the output is byte-for-byte reproducible.
 */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, (_k, v) => (typeof v === "number" ? round3(v) : v), 2)}\n`;
}

export function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

export function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** A CLI-level failure: reported as a message and exit code 1, never a stack. */
export class CliError extends Error {}
