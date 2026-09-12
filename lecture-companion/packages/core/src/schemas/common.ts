import { z } from "zod";

/** A [left, top, width, height] rectangle in top-left-origin page space at scale 1. */
export const BoxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);
export type Box = z.infer<typeof BoxSchema>;

/** Raw pdf.js text-item transform: [a, b, c, d, e, f]. */
export const TransformSchema = z.tuple([
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);
export type Transform = z.infer<typeof TransformSchema>;

/** YYYY-MM-DD */
export const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** ISO-8601 timestamp, milliseconds and offset allowed. */
export const IsoTimestampSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "expected an ISO-8601 timestamp",
  );

export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, "expected a lowercase sha256 hex digest");

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

/** pdf.js extraction options; architecture.md §4.2 fixes both values. */
export const ExtractOptionsSchema = z.object({
  includeMarkedContent: z.literal(false),
  disableNormalization: z.literal(false),
});
export type ExtractOptions = z.infer<typeof ExtractOptionsSchema>;

/** The pdf.js version this project is pinned to (architecture.md §4.2). */
export const PDFJS_VERSION = "6.3.289" as const;
