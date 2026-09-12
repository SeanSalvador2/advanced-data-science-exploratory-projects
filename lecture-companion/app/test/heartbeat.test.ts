import { describe, expect, it } from "vitest";

import type { Heartbeat } from "@lecture/core";

import {
  classifyHeartbeat,
  parseHeartbeat,
  recorderText,
  STALE_AFTER_MS,
} from "../src/lib/heartbeat.ts";

const base = Date.parse("2026-09-15T09:30:00.000Z");

function beat(agoMs: number, elapsedS: number): Heartbeat {
  return {
    pid: 4242,
    startedWall: "2026-09-15T09:00:00.000Z",
    updatedWall: new Date(base - agoMs).toISOString(),
    elapsedS,
    rmsRecent: 0.02,
  };
}

describe("classifyHeartbeat", () => {
  it("says there is no recorder when the file is absent", () => {
    expect(classifyHeartbeat(null, base)).toEqual({ kind: "none" });
    expect(recorderText({ kind: "none" })).toBe("no recorder");
  });

  it("shows elapsed time while the beat is fresh", () => {
    expect(classifyHeartbeat(beat(1000, 42), base)).toEqual({ kind: "live", elapsedS: 42 });
    expect(recorderText({ kind: "live", elapsedS: 42 })).toBe("rec 00:42");
    expect(recorderText({ kind: "live", elapsedS: 754 })).toBe("rec 12:34");
  });

  it("treats exactly the threshold as still live", () => {
    expect(classifyHeartbeat(beat(STALE_AFTER_MS, 10), base).kind).toBe("live");
  });

  it("goes stale past six seconds and says how long it has been", () => {
    const state = classifyHeartbeat(beat(14_000, 900), base);
    expect(state).toEqual({ kind: "stale", sinceS: 14 });
    expect(recorderText(state)).toBe("rec stale 14s");
  });

  it("treats an unparseable timestamp as no recorder", () => {
    const bad = { ...beat(0, 1), updatedWall: "not a time" } as Heartbeat;
    expect(classifyHeartbeat(bad, base)).toEqual({ kind: "none" });
  });
});

describe("parseHeartbeat", () => {
  it("accepts the recorder's document", () => {
    expect(parseHeartbeat(beat(0, 3))).not.toBeNull();
  });

  it("rejects anything that is not one", () => {
    expect(parseHeartbeat(null)).toBeNull();
    expect(parseHeartbeat({})).toBeNull();
    expect(parseHeartbeat({ pid: 1 })).toBeNull();
    expect(parseHeartbeat("rec")).toBeNull();
  });
});
