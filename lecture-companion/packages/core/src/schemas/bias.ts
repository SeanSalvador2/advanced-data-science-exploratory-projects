import { z } from "zod";

/** Caps the Python spike enforces when it serialises `bias.json`. */
export const MAX_PAGE_BIAS_TERMS = 40;
export const MAX_GLOBAL_BIAS_TERMS = 60;

/**
 * Who wrote the file: the spike's heuristic extractor, the
 * `/lecture-bias-terms` skill, or `lecture bias` deriving it from `terms.json`.
 */
export const BiasSourceSchema = z.enum(["heuristic", "claude", "derived"]);
export type BiasSource = z.infer<typeof BiasSourceSchema>;

export const BiasPageTermsSchema = z.object({
  page: z.number().int().positive(),
  terms: z.array(z.string()).max(MAX_PAGE_BIAS_TERMS),
});
export type BiasPageTerms = z.infer<typeof BiasPageTermsSchema>;

/**
 * architecture.md §4.3 — `bias.json`, the vocabulary the transcriber biases
 * towards. The field shape is fixed by `spike/src/spike/schemas.py`, which
 * reads the file today; `global` is a reserved word in neither JSON nor Python
 * but is spelled exactly that way on disk.
 *
 * `schema` is optional because the `/lecture-bias-terms` skill has been writing
 * this file without it since before §3 asked every JSON file to carry one.
 * Files written by `lecture bias` do carry it, so `lecture validate` can
 * dispatch on it; the spike ignores keys it does not know.
 */
export const BiasTermsSchema = z.object({
  schema: z.literal("bias/1").optional(),
  deck: z.literal("deck.pdf"),
  source: BiasSourceSchema,
  pages: z.array(BiasPageTermsSchema),
  global: z.array(z.string()).max(MAX_GLOBAL_BIAS_TERMS),
});
export type BiasTerms = z.infer<typeof BiasTermsSchema>;
