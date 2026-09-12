import { HeartbeatSchema, type Heartbeat } from "@lecture/core";

import { mmss } from "../events/time.ts";

/** architecture.md §4.5: the beat is written every 2 s and is stale past 6. */
export const STALE_AFTER_MS = 6000;
export const HEARTBEAT_FILE = ".lecture/heartbeat.json";

export type RecorderState =
  | { kind: "none" }
  | { kind: "live"; elapsedS: number }
  | { kind: "stale"; sinceS: number };

/**
 * Turn the heartbeat file into what the status strip says. Elapsed time, never
 * a coloured dot (anti-pattern 4), and the stale colour is the only place
 * `--stale` is used anywhere in the app.
 */
export function classifyHeartbeat(
  beat: Heartbeat | null,
  now: number = Date.now(),
  staleAfterMs: number = STALE_AFTER_MS,
): RecorderState {
  if (!beat) return { kind: "none" };
  const updated = Date.parse(beat.updatedWall);
  if (!Number.isFinite(updated)) return { kind: "none" };
  const age = now - updated;
  if (age > staleAfterMs) return { kind: "stale", sinceS: Math.max(0, Math.round(age / 1000)) };
  return { kind: "live", elapsedS: beat.elapsedS };
}

export function recorderText(state: RecorderState): string {
  switch (state.kind) {
    case "none":
      return "no recorder";
    case "live":
      return `rec ${mmss(state.elapsedS)}`;
    case "stale":
      return `rec stale ${state.sinceS}s`;
  }
}

/** Parse a heartbeat document, returning null for anything malformed. */
export function parseHeartbeat(raw: unknown): Heartbeat | null {
  if (raw === null || raw === undefined) return null;
  const parsed = HeartbeatSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
