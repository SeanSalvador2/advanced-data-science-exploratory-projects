/**
 * ISO-8601 with milliseconds and the *local* offset, which is what
 * `IsoTimestampSchema` in `@lecture/core` accepts and what the transcriber
 * subtracts from `recording.json`'s `startedWall` to get the audio clock
 * (architecture.md §4.4). `Date.prototype.toISOString` is not usable here: it
 * always reports UTC with a `Z`, which loses the room's wall time.
 */
export function nowIso(date: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, "0");
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Seconds as `mm:ss`, used for the recorder's elapsed time in the strip. */
export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
