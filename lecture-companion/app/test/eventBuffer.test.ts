import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@lecture/core";

import { EventBuffer, IDLE_FLUSH_MS } from "../src/events/EventBuffer.ts";
import type { LectureFolder } from "../src/storage/LectureFolder.ts";

interface Recorder {
  folder: LectureFolder;
  appends: string[][];
  fail: boolean;
}

function fakeFolder(): Recorder {
  const rec: Recorder = {
    appends: [],
    fail: false,
    folder: {
      name: "fake",
      readJson: async () => null,
      readBinary: async () => new ArrayBuffer(0),
      appendLines: async (_name: string, lines: string[]) => {
        if (rec.fail) throw new Error("disk is busy");
        rec.appends.push(lines);
      },
      writeAtomic: async () => undefined,
      list: async () => [],
      watch: () => () => undefined,
      subfolder: async () => null,
    },
  };
  return rec;
}

const slide = (n: number): Event => ({
  wall: "2026-09-15T09:00:00.000-04:00",
  type: "slide",
  slide: n,
  source: "app",
});

describe("EventBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not write on enqueue", async () => {
    const rec = fakeFolder();
    const buffer = new EventBuffer({ folder: rec.folder });
    buffer.enqueue(slide(1));
    buffer.enqueue(slide(2));
    expect(buffer.pending).toBe(2);
    expect(rec.appends).toEqual([]);
    buffer.dispose();
  });

  it("flushes three seconds after the last enqueue, not the first", async () => {
    const rec = fakeFolder();
    const buffer = new EventBuffer({ folder: rec.folder });
    buffer.enqueue(slide(1));
    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS - 1);
    expect(rec.appends).toEqual([]);

    // A second event restarts the idle window.
    buffer.enqueue(slide(2));
    await vi.advanceTimersByTimeAsync(IDLE_FLUSH_MS - 1);
    expect(rec.appends).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(rec.appends).toHaveLength(1);
    expect(rec.appends[0]).toHaveLength(2);
    expect(JSON.parse(rec.appends[0]?.[0] as string)).toMatchObject({ type: "slide", slide: 1 });
    expect(buffer.pending).toBe(0);
    buffer.dispose();
  });

  it("writes one JSONL line per event", async () => {
    const rec = fakeFolder();
    const buffer = new EventBuffer({ folder: rec.folder });
    buffer.enqueue(slide(1));
    buffer.enqueue({ wall: "2026-09-15T09:00:01.000-04:00", type: "note", text: "why", source: "app" });
    await buffer.flush();
    expect(rec.appends[0]).toEqual([
      '{"wall":"2026-09-15T09:00:00.000-04:00","type":"slide","slide":1,"source":"app"}',
      '{"wall":"2026-09-15T09:00:01.000-04:00","type":"note","text":"why","source":"app"}',
    ]);
    buffer.dispose();
  });

  it("flushes on blur, on hidden and on pagehide", async () => {
    const rec = fakeFolder();
    const listeners = new Map<string, Array<() => void>>();
    const docListeners = new Map<string, Array<() => void>>();
    const fakeWindow = {
      addEventListener: (type: string, fn: () => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), fn]);
      },
      removeEventListener: () => undefined,
      document: {
        addEventListener: (type: string, fn: () => void) => {
          docListeners.set(type, [...(docListeners.get(type) ?? []), fn]);
        },
        removeEventListener: () => undefined,
      },
    } as unknown as Window;

    const buffer = new EventBuffer({ folder: rec.folder });
    buffer.attach(fakeWindow);

    buffer.enqueue(slide(1));
    listeners.get("blur")?.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.appends).toHaveLength(1);

    buffer.enqueue(slide(2));
    listeners.get("pagehide")?.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.appends).toHaveLength(2);

    vi.stubGlobal("document", { visibilityState: "hidden" });
    buffer.enqueue(slide(3));
    docListeners.get("visibilitychange")?.forEach((fn) => fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(rec.appends).toHaveLength(3);
    vi.unstubAllGlobals();
    buffer.dispose();
  });

  it("keeps the events when the write fails, and writes them on the next try", async () => {
    const rec = fakeFolder();
    rec.fail = true;
    const errors: unknown[] = [];
    const buffer = new EventBuffer({ folder: rec.folder, onError: (e) => errors.push(e) });
    buffer.enqueue(slide(1));
    await buffer.flush();
    expect(errors).toHaveLength(1);
    expect(buffer.pending).toBe(1);

    rec.fail = false;
    await buffer.flush();
    expect(rec.appends).toHaveLength(1);
    expect(buffer.pending).toBe(0);
    buffer.dispose();
  });

  it("does not append an empty batch", async () => {
    const rec = fakeFolder();
    const buffer = new EventBuffer({ folder: rec.folder });
    await buffer.flush();
    expect(rec.appends).toEqual([]);
    buffer.dispose();
  });

  it("reports the pending count as it changes", async () => {
    const rec = fakeFolder();
    const seen: number[] = [];
    const buffer = new EventBuffer({ folder: rec.folder, onChange: (n) => seen.push(n) });
    buffer.enqueue(slide(1));
    buffer.enqueue(slide(2));
    await buffer.flush();
    expect(seen).toEqual([1, 2, 0]);
    buffer.dispose();
  });
});
