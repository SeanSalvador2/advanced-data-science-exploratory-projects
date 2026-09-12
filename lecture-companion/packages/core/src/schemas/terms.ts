import { z } from "zod";
import { ConfidenceSchema, IsoTimestampSchema } from "./common.js";

export const TermKindSchema = z.enum([
  "concept",
  "notation",
  "method",
  "theorem",
  "dataset",
  "person",
  "metric",
  "other",
]);
export type TermKind = z.infer<typeof TermKindSchema>;

export const FirstSeenSchema = z.object({
  lectureId: z.string().min(1),
  page: z.number().int().positive(),
});

export const TermSchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  aliases: z.array(z.string()),
  kind: TermKindSchema,
  lineIds: z.array(z.number().int().nonnegative()),
  definition: z.string(),
  intuition: z.string(),
  inThisCourse: z.string(),
  firstSeen: FirstSeenSchema.optional(),
  confidence: ConfidenceSchema,
});
export type Term = z.infer<typeof TermSchema>;

export const PassageSchema = z.object({
  lineIds: z.array(z.number().int().nonnegative()),
  text: z.string(),
  explanation: z.string(),
});
export type Passage = z.infer<typeof PassageSchema>;

export const GlossaryEntrySchema = z.object({
  id: z.string().min(1),
  term: z.string().min(1),
  aliases: z.array(z.string()),
  kind: TermKindSchema,
  definition: z.string(),
  intuition: z.string(),
  inThisCourse: z.string(),
  firstSeen: FirstSeenSchema.optional(),
  pages: z.array(z.number().int().positive()),
});
export type GlossaryEntry = z.infer<typeof GlossaryEntrySchema>;

export const TermPageSchema = z.object({
  page: z.number().int().positive(),
  title: z.string(),
  summary: z.string(),
  overlayGroup: z.number().int().optional(),
  terms: z.array(TermSchema),
  passages: z.array(PassageSchema),
  asrBias: z.array(z.string()).max(40),
});
export type TermPage = z.infer<typeof TermPageSchema>;

/** architecture.md §4.3 — `terms.json` */
export const TermIndexSchema = z.object({
  schema: z.literal("terms/1"),
  lectureId: z.string().min(1),
  course: z.string().min(1),
  generated: IsoTimestampSchema,
  pages: z.array(TermPageSchema),
  glossary: z.array(GlossaryEntrySchema),
});
export type TermIndex = z.infer<typeof TermIndexSchema>;
