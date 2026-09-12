import { describe, expect, it } from "vitest";

import type { LectureManifest } from "@lecture/core";

import { flatten, scanLibrary } from "../src/lib/library.ts";
import type { LectureFolder } from "../src/storage/LectureFolder.ts";

interface Tree {
  [name: string]: Tree | string;
}

/** A LectureFolder over a plain object, so the scan can be tested on its own. */
function fakeFolder(tree: Tree, name = "vault"): LectureFolder {
  return {
    name,
    readJson: async <T,>(file: string): Promise<T | null> => {
      const value = tree[file];
      return typeof value === "string" ? (JSON.parse(value) as T) : null;
    },
    readBinary: async () => new ArrayBuffer(0),
    appendLines: async () => undefined,
    writeAtomic: async () => undefined,
    list: async () => Object.keys(tree),
    watch: () => () => undefined,
    subfolder: async (path: string) => {
      const value = tree[path];
      return value && typeof value !== "string" ? fakeFolder(value, path) : null;
    },
  };
}

function manifest(over: Partial<LectureManifest> & { lectureId: string }): string {
  const full: LectureManifest = {
    schema: "lecture/1",
    course: over.course ?? "TDL",
    date: over.date ?? "2026-03-04",
    deck: { file: "deck.pdf", sha256: "a".repeat(64), pages: over.deck?.pages ?? 62 },
    pdfjs: { version: "6.3.289", includeMarkedContent: false, disableNormalization: false },
    ...over,
    status: over.status ?? {},
  };
  return JSON.stringify(full);
}

const prepared = "2026-03-04T08:00:00.000-05:00";

describe("scanLibrary", () => {
  it("finds course/lecture folders two levels down and groups them", async () => {
    const root = fakeFolder({
      TDL: {
        "2026-03-04-lec09": {
          "lecture.json": manifest({
            lectureId: "2026-03-04-lec09",
            courseTitle: "Trustworthy Deep Learning",
            number: 9,
            title: "Certified Defenses",
            date: "2026-03-04",
            status: { prepared, terms: prepared },
          }),
        },
        "2026-02-27-lec08": {
          "lecture.json": manifest({
            lectureId: "2026-02-27-lec08",
            number: 8,
            date: "2026-02-27",
            status: { prepared },
          }),
        },
      },
      "not-a-course": { readme: "hello" },
    });

    const groups = await scanLibrary(root);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.course).toBe("TDL");
    expect(groups[0]?.courseTitle).toBe("Trustworthy Deep Learning");
    // Newest first.
    expect(groups[0]?.lectures.map((l) => l.lectureId)).toEqual([
      "2026-03-04-lec09",
      "2026-02-27-lec08",
    ]);
  });

  it("reads the pips from the manifest status", async () => {
    const root = fakeFolder({
      TDL: {
        lec01: {
          "lecture.json": manifest({
            lectureId: "lec01",
            status: { prepared, terms: prepared, recorded: prepared },
          }),
        },
      },
    });
    const [entry] = flatten(await scanLibrary(root));
    expect(entry?.pips).toEqual({
      prepared: true,
      terms: true,
      recorded: true,
      transcribed: false,
      notes: false,
    });
    expect(entry?.hasNotes).toBe(false);
  });

  it("opens in review only once notes exist", async () => {
    const root = fakeFolder({
      TDL: {
        lec01: {
          "lecture.json": manifest({
            lectureId: "lec01",
            status: { prepared, notes: prepared },
          }),
        },
      },
    });
    const [entry] = flatten(await scanLibrary(root));
    expect(entry?.hasNotes).toBe(true);
  });

  it("accepts a root that is itself a course folder", async () => {
    const root = fakeFolder({
      "2026-03-04-lec09": {
        "lecture.json": manifest({ lectureId: "2026-03-04-lec09", status: { prepared } }),
      },
    });
    const groups = await scanLibrary(root);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.course).toBe(".");
    expect(groups[0]?.lectures[0]?.lectureId).toBe("2026-03-04-lec09");
  });

  it("skips folders whose manifest is not valid, and hidden ones", async () => {
    const root = fakeFolder({
      TDL: {
        good: { "lecture.json": manifest({ lectureId: "good", status: { prepared } }) },
        bad: { "lecture.json": '{"schema":"lecture/1"}' },
        empty: {},
      },
      ".git": { config: "x" },
    });
    const rows = flatten(await scanLibrary(root));
    expect(rows.map((r) => r.lectureId)).toEqual(["good"]);
  });

  it("counts a step as done when its artefact is on disk without a status stamp", async () => {
    const root = fakeFolder({
      TDL: {
        lec01: {
          "lecture.json": manifest({ lectureId: "lec01", status: {} }),
          "spans.json": "{}",
          "terms.json": "{}",
          "notes.json": "{}",
        },
      },
    });
    const [entry] = flatten(await scanLibrary(root));
    expect(entry?.pips).toEqual({
      prepared: true,
      terms: true,
      recorded: false,
      transcribed: false,
      notes: true,
    });
    // And that is what sends Enter to review rather than lecture mode.
    expect(entry?.hasNotes).toBe(true);
  });

  it("returns nothing for an empty vault rather than failing", async () => {
    expect(await scanLibrary(fakeFolder({}))).toEqual([]);
  });

  it("keeps the page count from the manifest", async () => {
    const root = fakeFolder({
      TDL: {
        lec: {
          "lecture.json": manifest({
            lectureId: "lec",
            status: { prepared },
            deck: { file: "deck.pdf", sha256: "b".repeat(64), pages: 40 },
          }),
        },
      },
    });
    const [entry] = flatten(await scanLibrary(root));
    expect(entry?.manifest.deck.pages).toBe(40);
  });
});
