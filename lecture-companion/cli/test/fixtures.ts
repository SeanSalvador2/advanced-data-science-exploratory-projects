import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_DIR = path.resolve(here, "../../packages/core/test/fixtures");

export const FIXTURES = {
  html: path.join(FIXTURE_DIR, "html-slides.pdf"),
  latex: path.join(FIXTURE_DIR, "latex-slides.pdf"),
} as const;

/**
 * sha256 of `canonicalSpanText` for each committed fixture, pinned so that a
 * pdf.js upgrade that shifts span ids or boxes fails the build instead of
 * silently invalidating every note anchor (architecture.md §11).
 *
 * Regenerate with `npx lecture hash-spans <dir>` after `lecture prepare`, and
 * only when the change is understood.
 */
export const EXPECTED_SPAN_HASH = {
  html: "547d33e18ba1967ca38b70aaa4c08b0ccbae7767f4c9dcbbb079142fe5501fee",
  latex: "05e5b39d849bdeb926af6c32b4580e9b6e283259f30a0992c299c733713d2e6f",
} as const;
