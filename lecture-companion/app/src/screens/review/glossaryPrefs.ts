/**
 * Whether the glossary panel is open, remembered per browser.
 *
 * Like every other persisted bit in this app it is convenience only, so a
 * private window that throws on read or write must not break the screen.
 */
const KEY = "lecture.review.glossary";

export function loadGlossaryOpen(): boolean {
  try {
    return localStorage.getItem(KEY) === "open";
  } catch {
    return false;
  }
}

export function saveGlossaryOpen(open: boolean): void {
  try {
    localStorage.setItem(KEY, open ? "open" : "closed");
  } catch {
    // Site data blocked. The panel still opens, it just forgets.
  }
}
