import { z } from "zod";
import {
  DateOnlySchema,
  ExtractOptionsSchema,
  IsoTimestampSchema,
  PDFJS_VERSION,
  Sha256Schema,
} from "./common.js";

/** architecture.md §4.1 — `lecture.json` */
export const LectureManifestSchema = z.object({
  schema: z.literal("lecture/1"),
  lectureId: z.string().min(1),
  course: z.string().min(1),
  courseTitle: z.string().optional(),
  number: z.number().int().optional(),
  title: z.string().optional(),
  date: DateOnlySchema,
  deck: z.object({
    file: z.literal("deck.pdf"),
    sha256: Sha256Schema,
    pages: z.number().int().positive(),
  }),
  pdfjs: ExtractOptionsSchema.extend({
    version: z.literal(PDFJS_VERSION),
  }),
  status: z.object({
    prepared: IsoTimestampSchema.optional(),
    terms: IsoTimestampSchema.optional(),
    recorded: IsoTimestampSchema.optional(),
    transcribed: IsoTimestampSchema.optional(),
    notes: IsoTimestampSchema.optional(),
    exported: IsoTimestampSchema.optional(),
  }),
  priorLectures: z.array(z.string()).optional(),
});
export type LectureManifest = z.infer<typeof LectureManifestSchema>;
