import { z } from "zod";
import { BoxSchema, ExtractOptionsSchema, PDFJS_VERSION, Sha256Schema, TransformSchema } from "./common.js";

export const SpanItemSchema = z.object({
  id: z.number().int().nonnegative(),
  str: z.string(),
  box: BoxSchema,
  transform: TransformSchema,
  font: z.string(),
  eol: z.boolean(),
});
export type SpanItem = z.infer<typeof SpanItemSchema>;

export const SpanLineKindSchema = z.enum(["title", "bullet", "math", "caption", "text"]);
export type SpanLineKind = z.infer<typeof SpanLineKindSchema>;

export const SpanLineSchema = z.object({
  id: z.number().int().nonnegative(),
  items: z.array(z.number().int().nonnegative()),
  text: z.string(),
  box: BoxSchema,
  kind: SpanLineKindSchema.optional(),
});
export type SpanLine = z.infer<typeof SpanLineSchema>;

export const SpanPageSchema = z.object({
  page: z.number().int().positive(),
  width: z.number(),
  height: z.number(),
  items: z.array(SpanItemSchema),
  lines: z.array(SpanLineSchema),
});
export type SpanPage = z.infer<typeof SpanPageSchema>;

/** architecture.md §4.2 — `spans.json` */
export const SpanIndexSchema = z.object({
  schema: z.literal("spans/1"),
  pdfjsVersion: z.literal(PDFJS_VERSION),
  extractOptions: ExtractOptionsSchema,
  deckSha256: Sha256Schema,
  pages: z.array(SpanPageSchema),
});
export type SpanIndex = z.infer<typeof SpanIndexSchema>;
