import { z } from "zod";
import { IsoTimestampSchema } from "./common.js";

/** architecture.md §4.5 — `recording.json` (the spike's RecordingMeta plus `schema`). */
export const RecordingMetaSchema = z.object({
  schema: z.literal("recording/1"),
  startedWall: IsoTimestampSchema,
  stoppedWall: IsoTimestampSchema.optional(),
  durationS: z.number().nonnegative().optional(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
  device: z.string().optional(),
  file: z.string().min(1),
});
export type RecordingMeta = z.infer<typeof RecordingMetaSchema>;

/** architecture.md §4.5 — `.lecture/heartbeat.json`. */
export const HeartbeatSchema = z.object({
  pid: z.number().int(),
  startedWall: IsoTimestampSchema,
  updatedWall: IsoTimestampSchema,
  elapsedS: z.number().nonnegative(),
  rmsRecent: z.number(),
});
export type Heartbeat = z.infer<typeof HeartbeatSchema>;
