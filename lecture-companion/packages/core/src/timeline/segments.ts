import type { Transcript, TranscriptSegment } from "../schemas/transcript.js";

/** What the transcriber believes was said while one page was on screen. */
export function segmentsForPage(transcript: Transcript, page: number): TranscriptSegment[] {
  return transcript.segments.filter((s) => s.slide === page).sort((a, b) => a.start - b.start);
}

/**
 * The stretch of audio a page owns, from the first word said over it to the
 * last. Null when the transcriber never attributed a segment to it, which is
 * how a page that was skipped is told apart from one that was shown in
 * silence.
 */
export function pageSpan(transcript: Transcript, page: number): { startS: number; endS: number } | null {
  let startS = Number.POSITIVE_INFINITY;
  let endS = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const segment of transcript.segments) {
    if (segment.slide !== page) continue;
    found = true;
    if (segment.start < startS) startS = segment.start;
    if (segment.end > endS) endS = segment.end;
  }
  return found ? { startS, endS } : null;
}

/** Every page the transcript attributes at least one segment to, ascending. */
export function transcribedPages(transcript: Transcript): number[] {
  const seen = new Set<number>();
  for (const segment of transcript.segments) {
    if (typeof segment.slide === "number") seen.add(segment.slide);
  }
  return [...seen].sort((a, b) => a - b);
}

/** The end of the last segment, or null for an empty transcript. */
export function lastSegmentEnd(transcript: Transcript): number | null {
  let end: number | null = null;
  for (const segment of transcript.segments) {
    if (end === null || segment.end > end) end = segment.end;
  }
  return end;
}
