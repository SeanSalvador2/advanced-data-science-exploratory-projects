import {
  LectureManifestSchema,
  LectureNotesSchema,
  TermIndexSchema,
  type LectureManifest,
  type LectureNotes,
  type SpanIndex,
  type TermIndex,
} from "@lecture/core";

import { loadDocument, type PDFDocumentProxy } from "../pdf/index.ts";
import type { LectureFolder } from "../storage/LectureFolder.ts";

/** Everything review mode reads from a lecture folder, read once per lecture. */
export interface ReviewData {
  folder: LectureFolder;
  manifest: LectureManifest;
  doc: PDFDocumentProxy;
  spans: SpanIndex | null;
  terms: TermIndex | null;
  notes: LectureNotes | null;
  /**
   * The absolute path of `<lectureId>.md`, when the adapter can know it. The
   * File System Access API cannot, so `o` says so rather than guessing.
   */
  markdownPath: string | null;
}

/**
 * Open a prepared, noted lecture for review.
 *
 * A malformed `notes.json` or `terms.json` is the same as an absent one: the
 * rail would otherwise show half a page of notes and no way to tell which half
 * is missing. The manifest and the deck are the only hard requirements.
 */
export async function loadReview(root: LectureFolder, path: string): Promise<ReviewData> {
  const folder = await root.subfolder(path);
  if (!folder) throw new Error(`there is no folder ${path} in this vault`);

  const parsedManifest = LectureManifestSchema.safeParse(
    await folder.readJson<unknown>("lecture.json"),
  );
  if (!parsedManifest.success) {
    throw new Error(`${path}/lecture.json is missing or is not a lecture manifest`);
  }
  const manifest = parsedManifest.data;

  const doc = await loadDocument(await folder.readBinary("deck.pdf"));
  const spans = await folder.readJson<SpanIndex>("spans.json").catch(() => null);

  const rawTerms = await folder.readJson<unknown>("terms.json").catch(() => null);
  const parsedTerms = rawTerms === null ? null : TermIndexSchema.safeParse(rawTerms);
  const rawNotes = await folder.readJson<unknown>("notes.json").catch(() => null);
  const parsedNotes = rawNotes === null ? null : LectureNotesSchema.safeParse(rawNotes);

  const markdownPath =
    (await folder.absolutePath?.(`${manifest.lectureId}.md`).catch(() => null)) ?? null;

  return {
    folder,
    manifest,
    doc,
    spans,
    terms: parsedTerms?.success ? parsedTerms.data : null,
    notes: parsedNotes?.success ? parsedNotes.data : null,
    markdownPath,
  };
}
