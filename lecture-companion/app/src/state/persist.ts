/**
 * The small persisted bits: theme, dimmer, and the page each lecture was last
 * left on. All of it is per-browser convenience, so localStorage is right and
 * a private window that throws on write must not break the app.
 */

export type ThemeSetting = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

const THEME_KEY = "lecture.theme";
const DIM_KEY = "lecture.dim";
const PAGE_KEY = "lecture.page.";

/** ui-direction.md §A: 0.86 in the dark hall, 1.0 in a lit room. */
export const DIM_DARK_DEFAULT = 0.86;
export const DIM_LIGHT_DEFAULT = 1;
export const DIM_STEP = 0.04;
export const DIM_MIN = 0.5;
export const DIM_MAX = 1;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private window, or site data blocked. Nothing here is worth failing over.
  }
}

export function loadThemeSetting(): ThemeSetting {
  const raw = read(THEME_KEY);
  return raw === "light" || raw === "dark" ? raw : "auto";
}

export function saveThemeSetting(setting: ThemeSetting): void {
  write(THEME_KEY, setting);
}

export function loadDim(fallback: number): number {
  const raw = read(DIM_KEY);
  const value = raw === null ? Number.NaN : Number.parseFloat(raw);
  return Number.isFinite(value) ? clampDim(value) : fallback;
}

export function saveDim(dim: number): void {
  write(DIM_KEY, dim.toFixed(2));
}

export function clampDim(dim: number): number {
  return Math.min(DIM_MAX, Math.max(DIM_MIN, Math.round(dim * 100) / 100));
}

export function loadLastPage(lectureId: string): number | null {
  const raw = read(PAGE_KEY + lectureId);
  const value = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

export function saveLastPage(lectureId: string, page: number): void {
  write(PAGE_KEY + lectureId, String(page));
}

/**
 * The room decides the theme, not the OS, so this never consults
 * `prefers-color-scheme` (ui-direction.md §A). "auto" means the mode's own
 * default: dark in lecture, light in library and review.
 */
export function effectiveTheme(setting: ThemeSetting, mode: "lecture" | "review" | "library"): Theme {
  if (setting === "light" || setting === "dark") return setting;
  return mode === "lecture" ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset["theme"] = theme;
}
