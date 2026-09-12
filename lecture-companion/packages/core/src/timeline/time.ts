import type { Event } from "../schemas/events.js";
import type { RecordingMeta } from "../schemas/recording.js";

/**
 * Windows shorter than this are a keypress, not a slide: the app writes a
 * `slide` event per arrow press, so paging through three slides to reach the
 * fourth leaves two windows of a few hundred milliseconds that nothing was
 * ever said over. Dropping them keeps those pages honestly "never shown".
 */
export const MIN_WINDOW_S = 0.5;

/** A stretch of the audio clock during which one page was on screen. */
export interface SlideWindow {
  start: number;
  end: number;
}

/** A note the student typed, placed on the page that was up when they typed it. */
export interface PlacedStudentNote {
  text: string;
  t: number;
  /** The page whose window contains `t`, or null if no window does. */
  page: number | null;
}

function parseWall(wall: string): number | null {
  const ms = Date.parse(wall);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * An event's position on the audio clock, in seconds (architecture.md §4.4).
 *
 * The recorder stamps both clocks, so its events carry `t` already. The app
 * stamps only `wall`, and the offset from the recording's start is what turns
 * that into an audio time. Returns null when neither is available — an app
 * event in a folder with no `recording.json` cannot be placed, and guessing
 * zero would put it on the title slide.
 */
export function eventT(event: Event, recording: RecordingMeta | null | undefined): number | null {
  if (typeof event.t === "number" && Number.isFinite(event.t)) return event.t;
  if (recording === null || recording === undefined) return null;
  const at = parseWall(event.wall);
  const started = parseWall(recording.startedWall);
  if (at === null || started === null) return null;
  return (at - started) / 1000;
}

/**
 * Every page's time on screen, as one window per visit.
 *
 * A window runs from its `slide` event to the next one, or to the end of the
 * recording for the last page. A page shown twice therefore has two windows,
 * and the notes for it come from both stretches of transcript.
 */
export function slideWindows(
  events: readonly Event[],
  recording: RecordingMeta | null | undefined,
  durationS: number,
): Map<number, SlideWindow[]> {
  const marks: Array<{ page: number; t: number }> = [];
  for (const event of events) {
    if (event.type !== "slide") continue;
    if (typeof event.slide !== "number") continue;
    const t = eventT(event, recording);
    if (t === null) continue;
    marks.push({ page: event.slide, t });
  }
  // A stable sort keeps two events stamped in the same millisecond in the
  // order the app wrote them, which is the order they happened.
  marks.sort((a, b) => a.t - b.t);

  const windows = new Map<number, SlideWindow[]>();
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i] as { page: number; t: number };
    const next = marks[i + 1];
    const start = Math.max(0, mark.t);
    const end = next === undefined ? durationS : next.t;
    if (end - start < MIN_WINDOW_S) continue;
    const bucket = windows.get(mark.page);
    if (bucket === undefined) windows.set(mark.page, [{ start, end }]);
    else bucket.push({ start, end });
  }
  return windows;
}

/** The page whose window contains `t`, or null. First match wins. */
export function pageAt(windows: ReadonlyMap<number, SlideWindow[]>, t: number): number | null {
  let best: { page: number; start: number } | null = null;
  for (const [page, list] of windows) {
    for (const w of list) {
      if (t < w.start || t > w.end) continue;
      // Windows abut, so a note stamped exactly on a boundary matches two of
      // them; the later window is the one the student was looking at.
      if (best === null || w.start > best.start) best = { page, start: w.start };
    }
  }
  return best === null ? null : best.page;
}

/**
 * The student's typed notes, in time order, each placed on the page that was
 * on screen when it was typed. A note outside every window keeps `page: null`
 * rather than being dropped: it still belongs in the lecture.
 */
export function studentNotes(
  events: readonly Event[],
  recording: RecordingMeta | null | undefined,
  windows: ReadonlyMap<number, SlideWindow[]>,
): PlacedStudentNote[] {
  const out: PlacedStudentNote[] = [];
  for (const event of events) {
    if (event.type !== "note") continue;
    const text = event.text ?? "";
    if (text.trim() === "") continue;
    const t = eventT(event, recording);
    if (t === null) continue;
    out.push({ text, t, page: pageAt(windows, t) });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * How long the recording ran: the metadata's duration, else the last event on
 * the audio clock, else the end of the last transcript segment. Callers pass
 * whichever of the three they have; the first finite one wins.
 */
export function recordingDuration(
  recording: RecordingMeta | null | undefined,
  events: readonly Event[],
  lastSegmentEnd: number | null,
): number {
  if (recording !== null && recording !== undefined && typeof recording.durationS === "number") {
    return recording.durationS;
  }
  let last = 0;
  for (const event of events) {
    const t = eventT(event, recording);
    if (t !== null && t > last) last = t;
  }
  if (last > 0) return last;
  return lastSegmentEnd ?? 0;
}
