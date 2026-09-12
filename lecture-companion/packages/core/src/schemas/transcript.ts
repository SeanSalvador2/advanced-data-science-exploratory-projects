import { z } from "zod";
import { IsoTimestampSchema } from "./common.js";

export const TranscriptWordSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
});
export type TranscriptWord = z.infer<typeof TranscriptWordSchema>;

export const TranscriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  slide: z.number().int().nullable(),
  start: z.number(),
  end: z.number(),
  prompt: z.string(),
  text: z.string(),
  words: z.array(TranscriptWordSchema),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

/** architecture.md §4.6 — `transcript.json` */
export const TranscriptSchema = z.object({
  schema: z.literal("transcript/1"),
  engine: z.string(),
  model: z.string(),
  condition: z.enum(["plain", "biased"]),
  created: IsoTimestampSchema,
  segments: z.array(TranscriptSegmentSchema),
});
export type Transcript = z.infer<typeof TranscriptSchema>;
