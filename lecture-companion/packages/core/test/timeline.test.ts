import { describe, expect, it } from "vitest";
import {
  eventT,
  lastSegmentEnd,
  MIN_WINDOW_S,
  pageAt,
  pageSpan,
  recordingDuration,
  segmentsForPage,
  slideWindows,
  studentNotes,
  transcribedPages,
} from "../src/index.js";
import type { Event, RecordingMeta, Transcript } from "../src/index.js";

const STARTED = "2026-09-15T14:00:00.000+00:00";

function recording(overrides: Partial<RecordingMeta> = {}): RecordingMeta {
  return {
    schema: "recording/1",
    startedWall: STARTED,
    durationS: 1200,
    sampleRate: 16000,
    channels: 1,
    file: "audio.wav",
    ...overrides,
  };
}

/** The wall clock `t` seconds into the recording. */
function wall(t: number): string {
  return new Date(Date.parse(STARTED) + t * 1000).toISOString().replace("Z", "+00:00");
}

function slide(page: number, t: number): Event {
  return { wall: wall(t), type: "slide", slide: page, source: "app" };
}

function note(text: string, t: number): Event {
  return { wall: wall(t), type: "note", text, source: "app" };
}

describe("eventT", () => {
  it("prefers the audio clock the recorder stamped", () => {
    const event: Event = { t: 12.5, wall: wall(999), type: "start", source: "recorder" };
    expect(eventT(event, recording())).toBe(12.5);
  });

  it("derives t from the wall clock for app events", () => {
    expect(eventT(slide(2, 130), recording())).toBe(130);
    expect(eventT(slide(2, 0.25), recording())).toBe(0.25);
  });

  it("is null when neither clock can be resolved", () => {
    expect(eventT(slide(2, 130), null)).toBeNull();
    expect(eventT({ wall: "2026-09-15T14:00:00.000+00:00", type: "stop" }, null)).toBeNull();
  });
});

describe("slideWindows", () => {
  it("runs each window to the next slide event and the last to the end", () => {
    const windows = slideWindows([slide(1, 0), slide(2, 100)], recording(), 300);
    expect(windows.get(1)).toEqual([{ start: 0, end: 100 }]);
    expect(windows.get(2)).toEqual([{ start: 100, end: 300 }]);
  });

  it("gives a page shown twice two windows", () => {
    const windows = slideWindows(
      [slide(1, 0), slide(3, 100), slide(4, 200), slide(3, 300)],
      recording(),
      400,
    );
    expect(windows.get(3)).toEqual([
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ]);
    expect(windows.get(4)).toHaveLength(1);
  });

  it("drops a window shorter than half a second: that is paging through, not showing", () => {
    const windows = slideWindows(
      [slide(1, 0), slide(2, 100), slide(3, 100.2), slide(4, 100.4), slide(5, 200)],
      recording(),
      300,
    );
    expect(windows.has(2)).toBe(false);
    expect(windows.has(3)).toBe(false);
    expect(windows.get(4)).toEqual([{ start: 100.4, end: 200 }]);
    expect(MIN_WINDOW_S).toBe(0.5);
  });

  it("sorts by time, not by file order", () => {
    const windows = slideWindows([slide(2, 100), slide(1, 0)], recording(), 200);
    expect(windows.get(1)).toEqual([{ start: 0, end: 100 }]);
  });

  it("ignores events it cannot place", () => {
    expect(slideWindows([slide(1, 0), slide(2, 100)], null, 300).size).toBe(0);
  });
});

describe("studentNotes", () => {
  it("places each typed note on the page whose window contains it", () => {
    const events = [slide(1, 0), slide(2, 100), note("first", 50), note("second", 150)];
    const windows = slideWindows(events, recording(), 300);
    expect(studentNotes(events, recording(), windows)).toEqual([
      { text: "first", t: 50, page: 1 },
      { text: "second", t: 150, page: 2 },
    ]);
  });

  it("keeps a note that falls outside every window, with a null page", () => {
    const events = [slide(1, 100), note("before anything", 10)];
    const windows = slideWindows(events, recording(), 300);
    expect(studentNotes(events, recording(), windows)).toEqual([
      { text: "before anything", t: 10, page: null },
    ]);
  });

  it("puts a note on a boundary on the page that was just opened", () => {
    const windows = slideWindows([slide(1, 0), slide(2, 100)], recording(), 300);
    expect(pageAt(windows, 100)).toBe(2);
  });

  it("drops empty notes and sorts by time", () => {
    const events = [slide(1, 0), note("   ", 40), note("late", 80), note("early", 20)];
    const windows = slideWindows(events, recording(), 300);
    expect(studentNotes(events, recording(), windows).map((n) => n.text)).toEqual(["early", "late"]);
  });
});

describe("recordingDuration", () => {
  it("prefers the metadata, then the last event, then the transcript", () => {
    expect(recordingDuration(recording(), [], null)).toBe(1200);
    const noDuration = recording();
    delete (noDuration as { durationS?: number }).durationS;
    expect(recordingDuration(noDuration, [{ t: 900, wall: wall(900), type: "stop" }], 800)).toBe(900);
    expect(recordingDuration(null, [], 640)).toBe(640);
    expect(recordingDuration(null, [], null)).toBe(0);
  });
});

function transcript(segments: Array<{ slide: number | null; start: number; end: number }>): Transcript {
  return {
    schema: "transcript/1",
    engine: "faster-whisper",
    model: "small.en",
    condition: "biased",
    created: STARTED,
    segments: segments.map((s, i) => ({
      id: i,
      slide: s.slide,
      start: s.start,
      end: s.end,
      prompt: "",
      text: `segment ${i}`,
      words: [],
    })),
  };
}

describe("segmentsForPage and pageSpan", () => {
  const t = transcript([
    { slide: 3, start: 720, end: 740 },
    { slide: 1, start: 0, end: 100 },
    { slide: 3, start: 330, end: 350 },
    { slide: null, start: 350, end: 360 },
  ]);

  it("returns a page's segments in time order, both visits included", () => {
    expect(segmentsForPage(t, 3).map((s) => s.start)).toEqual([330, 720]);
    expect(segmentsForPage(t, 2)).toEqual([]);
  });

  it("spans a page from its first word to its last", () => {
    expect(pageSpan(t, 3)).toEqual({ startS: 330, endS: 740 });
    expect(pageSpan(t, 2)).toBeNull();
  });

  it("lists the pages the transcript actually covers", () => {
    expect(transcribedPages(t)).toEqual([1, 3]);
    expect(lastSegmentEnd(t)).toBe(740);
  });
});
