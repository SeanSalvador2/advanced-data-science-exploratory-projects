import { z } from "zod";
import { IsoTimestampSchema } from "./common.js";

/**
 * architecture.md §4.4 — one `Event` per line of `events.jsonl`.
 * Unlike the other contracts this object carries no `schema` field, because it
 * is a JSON Lines record; `validateFile` therefore cannot dispatch to it and
 * callers validate lines with `EventSchema` directly.
 */
export const EventSchema = z.object({
  t: z.number().optional(),
  wall: IsoTimestampSchema,
  type: z.enum(["start", "slide", "note", "stop"]),
  slide: z.number().int().positive().optional(),
  text: z.string().optional(),
  source: z.enum(["app", "recorder"]).optional(),
});
export type Event = z.infer<typeof EventSchema>;
