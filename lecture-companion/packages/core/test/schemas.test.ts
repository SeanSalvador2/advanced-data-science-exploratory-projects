import { describe, expect, it } from "vitest";
import {
  EventSchema,
  HeartbeatSchema,
  PDFJS_VERSION,
  SCHEMAS,
  SCHEMA_NAMES,
  formatIssues,
  isSchemaName,
  validateFile,
  type SchemaName,
} from "../src/index.js";

/** One minimal-but-valid document per contract in architecture.md §4. */
const MINIMAL: Record<SchemaName, Record<string, unknown>> = {
  "lecture/1": {
    schema: "lecture/1",
    lectureId: "2026-09-15-lec05",
    course: "TDL",
    date: "2026-09-15",
    deck: { file: "deck.pdf", sha256: "a".repeat(64), pages: 12 },
    pdfjs: { version: PDFJS_VERSION, includeMarkedContent: false, disableNormalization: false },
    status: {},
  },
  "spans/1": {
    schema: "spans/1",
    pdfjsVersion: PDFJS_VERSION,
    extractOptions: { includeMarkedContent: false, disableNormalization: false },
    deckSha256: "b".repeat(64),
    pages: [{ page: 1, width: 960, height: 540, items: [], lines: [] }],
  },
  "terms/1": {
    schema: "terms/1",
    lectureId: "lec05",
    course: "TDL",
    generated: "2026-09-15T20:14:00.000-04:00",
    pages: [],
    glossary: [],
  },
  "recording/1": {
    schema: "recording/1",
    startedWall: "2026-09-15T13:30:00.000-04:00",
    sampleRate: 16000,
    channels: 1,
    file: "audio.wav",
  },
  "transcript/1": {
    schema: "transcript/1",
    engine: "whisper.cpp",
    model: "large-v3",
    condition: "biased",
    created: "2026-09-15T19:00:00.000-04:00",
    segments: [],
  },
  "notes/1": {
    schema: "notes/1",
    lectureId: "lec05",
    generated: "2026-09-15T20:14:00.000-04:00",
    pages: [],
    openQuestions: [],
  },
};

describe("SCHEMAS", () => {
  it("covers every contract that carries a schema string", () => {
    expect(SCHEMA_NAMES.sort()).toEqual(
      ["lecture/1", "notes/1", "recording/1", "spans/1", "terms/1", "transcript/1"].sort(),
    );
    expect(Object.keys(MINIMAL).sort()).toEqual([...SCHEMA_NAMES].sort());
  });

  it("recognises its own names and nothing else", () => {
    for (const name of SCHEMA_NAMES) expect(isSchemaName(name)).toBe(true);
    expect(isSchemaName("spans/2")).toBe(false);
    expect(isSchemaName(7)).toBe(false);
  });
});

describe.each(SCHEMA_NAMES)("%s", (name) => {
  it("accepts a valid minimal document", () => {
    const parsed = SCHEMAS[name].safeParse(MINIMAL[name]);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("round-trips through validateFile", () => {
    const result = validateFile(MINIMAL[name]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.schema).toBe(name);
  });

  it("rejects a wrong schema string", () => {
    const wrong = { ...MINIMAL[name], schema: `${name}-nope` };
    expect(SCHEMAS[name].safeParse(wrong).success).toBe(false);

    const dispatched = validateFile(wrong);
    expect(dispatched.ok).toBe(false);
    if (!dispatched.ok) {
      expect(dispatched.issues[0]?.path).toBe("schema");
      expect(dispatched.issues[0]?.message).toContain("unknown schema");
    }
  });

  it("rejects a document missing a required field", () => {
    const stripped = { ...MINIMAL[name] };
    const victim = Object.keys(stripped).find((k) => k !== "schema") as string;
    delete stripped[victim];
    expect(SCHEMAS[name].safeParse(stripped).success).toBe(false);
  });
});

describe("validateFile", () => {
  it("reports a missing schema field", () => {
    const r = validateFile({ hello: "world" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.message).toContain("missing required `schema`");
  });

  it("rejects non-objects", () => {
    expect(validateFile(null).ok).toBe(false);
    expect(validateFile([1, 2]).ok).toBe(false);
    expect(validateFile("spans/1").ok).toBe(false);
  });

  it("reports field-level issues with readable paths", () => {
    const bad = { ...MINIMAL["spans/1"], deckSha256: "not-a-digest" };
    const r = validateFile(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues.map((i) => i.path)).toContain("deckSha256");
      expect(formatIssues(r.issues)).toContain("deckSha256");
    }
  });
});

describe("schema-less records", () => {
  it("validates an Event, which carries no schema field", () => {
    expect(
      EventSchema.safeParse({ wall: "2026-09-15T13:30:00.000-04:00", type: "slide", slide: 7 }).success,
    ).toBe(true);
    expect(EventSchema.safeParse({ wall: "13:30", type: "slide" }).success).toBe(false);
    expect(EventSchema.safeParse({ wall: "2026-09-15T13:30:00.000-04:00", type: "pause" }).success).toBe(
      false,
    );
  });

  it("validates a Heartbeat", () => {
    expect(
      HeartbeatSchema.safeParse({
        pid: 4242,
        startedWall: "2026-09-15T13:30:00.000-04:00",
        updatedWall: "2026-09-15T13:30:02.000-04:00",
        elapsedS: 2,
        rmsRecent: 0.013,
      }).success,
    ).toBe(true);
  });

  it("keeps Event and Heartbeat out of the dispatch map", () => {
    expect(isSchemaName("event/1")).toBe(false);
    expect(isSchemaName("heartbeat/1")).toBe(false);
  });
});
