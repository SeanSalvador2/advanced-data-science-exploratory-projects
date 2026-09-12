import { z } from "zod";

import { LectureManifestSchema, type LectureManifest } from "./lecture.js";
import { SpanIndexSchema, type SpanIndex } from "./spans.js";
import { TermIndexSchema, type TermIndex } from "./terms.js";
import { TranscriptSchema, type Transcript } from "./transcript.js";
import { RecordingMetaSchema, HeartbeatSchema, type RecordingMeta } from "./recording.js";
import { LectureNotesSchema, type LectureNotes } from "./notes.js";

export * from "./common.js";
export * from "./lecture.js";
export * from "./spans.js";
export * from "./terms.js";
export * from "./events.js";
export * from "./recording.js";
export * from "./transcript.js";
export * from "./notes.js";

/**
 * Every file contract that carries a `schema` string, keyed by that string.
 * `Heartbeat` and `Event` are deliberately absent: neither record carries a
 * `schema` field (architecture.md §4.4, §4.5), so neither can be dispatched to.
 */
export const SCHEMAS = {
  "lecture/1": LectureManifestSchema,
  "spans/1": SpanIndexSchema,
  "terms/1": TermIndexSchema,
  "recording/1": RecordingMetaSchema,
  "transcript/1": TranscriptSchema,
  "notes/1": LectureNotesSchema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;

export const SCHEMA_NAMES = Object.keys(SCHEMAS) as SchemaName[];

export type KnownDocument =
  | LectureManifest
  | SpanIndex
  | TermIndex
  | RecordingMeta
  | Transcript
  | LectureNotes;

export type DocumentFor<N extends SchemaName> = z.infer<(typeof SCHEMAS)[N]>;

export type ValidationIssue = { path: string; message: string };

export type ValidationResult =
  | { ok: true; schema: SchemaName; data: KnownDocument }
  | { ok: false; schema: string | null; issues: ValidationIssue[] };

export function isSchemaName(value: unknown): value is SchemaName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SCHEMAS, value);
}

/** Turn a zod error into flat, readable `path: message` pairs. */
export function toIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length === 0 ? "(root)" : issue.path.map(String).join("."),
    message: issue.message,
  }));
}

/** Render issues as one line each, for CLI output. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((i) => `  ${i.path}: ${i.message}`).join("\n");
}

/**
 * Validate a parsed JSON document against the schema named by its own
 * `schema` field. Unknown or missing `schema` strings fail with an issue on
 * the `schema` path rather than throwing.
 */
export function validateFile(json: unknown): ValidationResult {
  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { ok: false, schema: null, issues: [{ path: "(root)", message: "expected a JSON object" }] };
  }
  const raw = (json as { schema?: unknown }).schema;
  if (typeof raw !== "string") {
    return {
      ok: false,
      schema: null,
      issues: [{ path: "schema", message: "missing required `schema` string" }],
    };
  }
  if (!isSchemaName(raw)) {
    return {
      ok: false,
      schema: raw,
      issues: [
        {
          path: "schema",
          message: `unknown schema "${raw}"; expected one of ${SCHEMA_NAMES.join(", ")}`,
        },
      ],
    };
  }
  const parsed = SCHEMAS[raw].safeParse(json);
  if (!parsed.success) {
    return { ok: false, schema: raw, issues: toIssues(parsed.error) };
  }
  return { ok: true, schema: raw, data: parsed.data as KnownDocument };
}
