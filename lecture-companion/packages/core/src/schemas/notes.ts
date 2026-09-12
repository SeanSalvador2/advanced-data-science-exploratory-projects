import { z } from "zod";
import { ConfidenceSchema, IsoTimestampSchema } from "./common.js";

export const NoteTagSchema = z.enum([
  "intuition",
  "why-it-matters",
  "example",
  "aside",
  "correction",
  "exam-hint",
  "connection",
  "caveat",
  "definition-spoken",
  "question",
  "student",
]);
export type NoteTag = z.infer<typeof NoteTagSchema>;

export const NoteSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["generated", "student"]),
  text: z.string(),
  lineIds: z.array(z.number().int().nonnegative()),
  termIds: z.array(z.string()),
  tStart: z.number().nullable(),
  tEnd: z.number().nullable(),
  quote: z.string().optional(),
  tag: NoteTagSchema,
  answer: z.string().optional(),
  confidence: ConfidenceSchema,
});
export type Note = z.infer<typeof NoteSchema>;

export const NotePageSchema = z.object({
  page: z.number().int().positive(),
  title: z.string(),
  startS: z.number().nullable(),
  endS: z.number().nullable(),
  notes: z.array(NoteSchema),
});
export type NotePage = z.infer<typeof NotePageSchema>;

export const OpenQuestionSchema = z.object({
  text: z.string(),
  page: z.number().int().positive(),
  source: z.enum(["student", "professor"]),
  tStart: z.number().nullable(),
});
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>;

/** architecture.md §4.7 — `notes.json` */
export const LectureNotesSchema = z.object({
  schema: z.literal("notes/1"),
  lectureId: z.string().min(1),
  generated: IsoTimestampSchema,
  pages: z.array(NotePageSchema),
  openQuestions: z.array(OpenQuestionSchema),
});
export type LectureNotes = z.infer<typeof LectureNotesSchema>;
