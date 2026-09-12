import { describe, expect, it } from "vitest";

import { IsoTimestampSchema } from "@lecture/core";

import { mmss, nowIso } from "../src/events/time.ts";

describe("nowIso", () => {
  it("is accepted by the schema every event is validated against", () => {
    expect(IsoTimestampSchema.safeParse(nowIso()).success).toBe(true);
  });

  it("carries milliseconds and a local offset, not a Z", () => {
    const stamp = nowIso(new Date(2026, 8, 15, 9, 4, 5, 70));
    expect(stamp).toMatch(/^2026-09-15T09:04:05\.070(Z|[+-]\d{2}:\d{2})$/);
    expect(IsoTimestampSchema.safeParse(stamp).success).toBe(true);
  });

  it("round-trips back to the same instant", () => {
    const date = new Date(2026, 0, 2, 23, 59, 58, 1);
    expect(Date.parse(nowIso(date))).toBe(date.getTime());
  });

  it("pads every field", () => {
    const stamp = nowIso(new Date(2026, 0, 2, 3, 4, 5, 6));
    expect(stamp.startsWith("2026-01-02T03:04:05.006")).toBe(true);
  });
});

describe("mmss", () => {
  it("renders the recorder's elapsed seconds", () => {
    expect(mmss(0)).toBe("00:00");
    expect(mmss(42)).toBe("00:42");
    expect(mmss(754)).toBe("12:34");
    expect(mmss(3600)).toBe("60:00");
  });

  it("never goes backwards past zero", () => {
    expect(mmss(-5)).toBe("00:00");
  });
});
