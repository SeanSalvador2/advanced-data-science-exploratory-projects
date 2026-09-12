"""Turn (events, audio) into the list of pieces that get fed to an ASR engine.

Three jobs:
  0. events.jsonl -> the audio clock. The app writes slide and note events with
     a wall clock only; `normalize_events` projects them onto the audio clock
     using `recording.startedWall` before anything else looks at them.
  1. events.jsonl -> slide spans (which slide was up when).
  2. slide span   -> pieces of at most `max_piece_s` seconds, cut at the quietest
     moment in the last few seconds of the allowed window so we never slice a
     word in half.

Pieces are computed once and reused for every condition, so the plain and the
biased transcript are always comparable piece-for-piece.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Sequence

import numpy as np

from typing import Callable

from .schemas import Event, iso_delta_s

FRAME_S = 0.02          # 20 ms RMS frames
SEARCH_BACK_S = 6.0     # look this far back from the target for a quiet cut
MIN_SPAN_S = 0.05       # spans shorter than this are noise (double slide press)
#: How far past the end of the audio an event may still land before it is
#: treated as belonging to another recording. Clock skew between the app and
#: the recorder is milliseconds; 5 s is pure slack.
EVENT_SLACK_S = 5.0


# --------------------------------------------------------------------------- #
# audio
# --------------------------------------------------------------------------- #


def load_audio(path: str | Path) -> tuple[np.ndarray, int]:
    """Read a WAV as mono float32 in [-1, 1]. No ffmpeg involved."""
    import soundfile as sf

    data, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    return np.ascontiguousarray(data, dtype=np.float32), int(sr)


def frame_rms(audio: np.ndarray, sr: int, frame_s: float = FRAME_S) -> np.ndarray:
    """RMS per non-overlapping frame. Frame i covers [i*frame_s, (i+1)*frame_s)."""
    n = max(1, int(round(frame_s * sr)))
    if audio.size == 0:
        return np.zeros(0, dtype=np.float32)
    nframes = int(np.ceil(audio.size / n))
    pad = nframes * n - audio.size
    if pad:
        audio = np.concatenate([audio, np.zeros(pad, dtype=audio.dtype)])
    frames = audio.reshape(nframes, n).astype(np.float64)
    return np.sqrt((frames * frames).mean(axis=1)).astype(np.float32)


def rms(audio: np.ndarray) -> float:
    """RMS of a whole buffer (used by the recorder's silence warning)."""
    if audio.size == 0:
        return 0.0
    a = audio.astype(np.float64)
    return float(np.sqrt((a * a).mean()))


# --------------------------------------------------------------------------- #
# events -> the audio clock
# --------------------------------------------------------------------------- #


def _describe(ev: Event) -> str:
    what = ev.type if ev.slide is None else f"{ev.type} {ev.slide}"
    return f"{what} @ {ev.wall}"


def normalize_events(
    events: Sequence[Event],
    started_wall: Optional[str],
    duration_s: float,
    warn: Callable[[str], None] = print,
) -> list[Event]:
    """Give every event a time on the audio clock, drop the impossible ones.

    * `t` is kept when the writer supplied one (the recorder always does).
    * Otherwise `t = wall - started_wall`, which is how an app event written
      with a wall clock alone lands on the audio clock. Without a
      `recording.startedWall` the first `start` event's wall time is used, and
      if there is not one of those either the event has to be dropped.
    * Events before the audio starts or more than `EVENT_SLACK_S` past its end
      belong to some other recording; they are dropped and named.
    * The result is sorted by `t`, so slide events are in slide-change order
      however the two writers interleaved them in the file.
    """
    origin = started_wall
    if origin is None:
        for ev in events:
            if ev.type == "start" and ev.wall:
                origin = ev.wall
                break

    out: list[Event] = []
    undated: list[Event] = []
    outside: list[Event] = []
    for ev in events:
        if ev.t is None:
            if origin is None or not ev.wall:
                undated.append(ev)
                continue
            try:
                t = iso_delta_s(ev.wall, origin)
            except ValueError:
                undated.append(ev)
                continue
            ev = Event(wall=ev.wall, type=ev.type, t=t, slide=ev.slide,
                       text=ev.text, source=ev.source)
        if ev.t < 0.0 or ev.t > duration_s + EVENT_SLACK_S:
            outside.append(ev)
            continue
        out.append(ev)

    if undated:
        warn("dropped " + str(len(undated)) + " event(s) with no usable time "
             "(no `t`, and no recording.startedWall to project `wall` onto): "
             + ", ".join(_describe(e) for e in undated))
    if outside:
        warn("dropped " + str(len(outside)) + " event(s) outside the audio "
             f"(0 to {duration_s:.1f}s + {EVENT_SLACK_S:g}s): "
             + ", ".join(f"{_describe(e)} -> t={e.t:.1f}s" for e in outside))

    out.sort(key=lambda e: float(e.t))
    return out


# --------------------------------------------------------------------------- #
# events -> slide spans
# --------------------------------------------------------------------------- #


@dataclass
class SlideSpan:
    slide: Optional[int]
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def events_to_spans(events: Sequence[Event], duration_s: float) -> list[SlideSpan]:
    """Slide k spans from its event t to the next slide event t, or to the stop.

    Audio before the first slide event (and the whole file when there are no
    slide events at all) becomes a span with slide=None, so no audio is lost.
    """
    duration_s = float(duration_s)
    slides = sorted(
        [e for e in events
         if e.type == "slide" and e.slide is not None and e.t is not None],
        key=lambda e: e.t,
    )
    stop = duration_s
    for e in events:
        if e.type == "stop" and e.t is not None:
            stop = min(duration_s, float(e.t)) if duration_s > 0 else float(e.t)
    end_of_audio = duration_s if duration_s > 0 else stop

    if not slides:
        return [SlideSpan(None, 0.0, end_of_audio)] if end_of_audio > 0 else []

    spans: list[SlideSpan] = []
    first_t = max(0.0, float(slides[0].t))
    if first_t > MIN_SPAN_S:
        spans.append(SlideSpan(None, 0.0, first_t))

    for i, ev in enumerate(slides):
        start = max(0.0, float(ev.t))
        end = float(slides[i + 1].t) if i + 1 < len(slides) else end_of_audio
        end = min(end, end_of_audio)
        if end - start > MIN_SPAN_S:
            spans.append(SlideSpan(int(ev.slide), start, end))

    return spans


# --------------------------------------------------------------------------- #
# spans -> pieces
# --------------------------------------------------------------------------- #


@dataclass
class Piece:
    index: int
    slide: Optional[int]
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def _quietest_cut(
    rms_frames: np.ndarray,
    lo: float,
    hi: float,
    frame_s: float = FRAME_S,
) -> float:
    """Time of the centre of the quietest frame whose centre lies in [lo, hi]."""
    if hi <= lo or rms_frames.size == 0:
        return hi
    first = int(np.ceil((lo - 0.5 * frame_s) / frame_s))
    last = int(np.floor((hi - 0.5 * frame_s) / frame_s))
    first = max(0, first)
    last = min(rms_frames.size - 1, last)
    if last < first:
        return hi
    window = rms_frames[first : last + 1]
    idx = first + int(np.argmin(window))
    return (idx + 0.5) * frame_s


def split_span(
    start: float,
    end: float,
    rms_frames: np.ndarray,
    max_piece_s: float,
    frame_s: float = FRAME_S,
    search_back_s: float = SEARCH_BACK_S,
) -> list[tuple[float, float]]:
    """Contiguous (start, end) pieces covering [start, end], each <= max_piece_s."""
    start, end = float(start), float(end)
    if end <= start:
        return []
    pieces: list[tuple[float, float]] = []
    pos = start
    eps = 1e-9
    while (end - pos) > max_piece_s + eps:
        target = pos + max_piece_s
        lo = max(target - search_back_s, pos + frame_s)
        cut = _quietest_cut(rms_frames, lo, target, frame_s)
        cut = min(max(cut, pos + frame_s), target)
        if cut >= end:                      # nothing sensible left to cut
            break
        pieces.append((pos, cut))
        pos = cut
    pieces.append((pos, end))
    return pieces


def build_pieces(
    spans: Sequence[SlideSpan],
    rms_frames: np.ndarray,
    max_piece_s: float,
    frame_s: float = FRAME_S,
    search_back_s: float = SEARCH_BACK_S,
) -> list[Piece]:
    """Flatten every slide span into globally-indexed pieces."""
    out: list[Piece] = []
    for span in spans:
        for s, e in split_span(
            span.start, span.end, rms_frames, max_piece_s, frame_s, search_back_s
        ):
            out.append(Piece(index=len(out), slide=span.slide, start=s, end=e))
    return out


def slice_audio(audio: np.ndarray, sr: int, start: float, end: float) -> np.ndarray:
    a = max(0, int(round(start * sr)))
    b = min(audio.size, int(round(end * sr)))
    if b <= a:
        return np.zeros(0, dtype=np.float32)
    return np.ascontiguousarray(audio[a:b], dtype=np.float32)
