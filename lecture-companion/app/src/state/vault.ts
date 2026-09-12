import type { LectureFolder } from "../storage/LectureFolder.ts";
import {
  FsaLectureFolder,
  fsaSupported,
  pickRootHandle,
  queryVaultPermission,
  requestVaultPermission,
  storedRootHandle,
} from "../storage/fsa.ts";

/**
 * Which adapter is behind the vault.
 *
 * The dev adapter is chosen only when Vite is serving the app *and* the URL
 * carries `?dev`, because it is the only way to drive the app from Playwright
 * in this container (architecture.md §11). `import.meta.env.DEV` is a compile
 * time constant, so the whole branch — and the module it imports — is dropped
 * from the production bundle.
 */
export function devAdapterRequested(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).has("dev");
}

export type VaultStatus =
  | { kind: "loading" }
  | { kind: "unsupported" }
  | { kind: "needs-folder" }
  | { kind: "needs-permission" }
  | { kind: "ready"; root: LectureFolder }
  | { kind: "error"; message: string };

/** Restore the remembered vault, or say what the user has to do about it. */
export async function restoreVault(): Promise<VaultStatus> {
  if (devAdapterRequested()) {
    const { DevLectureFolder } = await import("../storage/dev.ts");
    return { kind: "ready", root: new DevLectureFolder() };
  }
  if (!fsaSupported()) return { kind: "unsupported" };
  const handle = await storedRootHandle().catch(() => null);
  if (!handle) return { kind: "needs-folder" };
  const permission = await queryVaultPermission(handle).catch(() => "prompt" as const);
  if (permission !== "granted") return { kind: "needs-permission" };
  return { kind: "ready", root: new FsaLectureFolder(handle) };
}

/** Must run inside a click: Chrome only shows the picker from a gesture. */
export async function chooseVault(): Promise<VaultStatus> {
  if (!fsaSupported()) return { kind: "unsupported" };
  try {
    const handle = await pickRootHandle();
    return { kind: "ready", root: new FsaLectureFolder(handle) };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return { kind: "needs-folder" };
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Must also run inside a click, for the same reason. */
export async function reopenVault(): Promise<VaultStatus> {
  const handle = await storedRootHandle().catch(() => null);
  if (!handle) return { kind: "needs-folder" };
  const permission = await requestVaultPermission(handle).catch(() => "denied" as const);
  if (permission !== "granted") return { kind: "needs-permission" };
  return { kind: "ready", root: new FsaLectureFolder(handle) };
}
