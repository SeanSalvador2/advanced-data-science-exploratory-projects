import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The app workspace root. */
export const APP_DIR = path.resolve(here, "..");

/**
 * The vault the dev middleware serves during the browser tests. It lives under
 * `test-results/`, which is gitignored, and the global setup rebuilds it.
 */
export const VAULT = path.join(APP_DIR, "test-results", "vault");

export const COURSE = "TEST";
export const FIXTURE = "lec-fixture";
export const LATEX = "lec-latex";
/** A copy of the fixture with no `terms.json`, built by `lookup.spec.ts`. */
export const NOINDEX = "lec-noindex";

export function lectureDir(lectureId: string): string {
  return path.join(VAULT, COURSE, lectureId);
}

export const SCREENSHOTS = path.join(APP_DIR, "e2e", "screenshots");

export const BASE_URL = "http://localhost:5175";

/** Every screen is behind `?dev`, which is what selects the dev adapter. */
export function appUrl(hash: string): string {
  return `${BASE_URL}/?dev#${hash}`;
}
