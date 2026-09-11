"""Turn (events, audio) into the list of pieces that get fed to an ASR engine.

Two jobs:
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

from .schemas import Event

FRAME_S = 0.02          # 20 ms RMS frames
SEARCH_BACK_S = 6.0     # look this far back from the target for a quiet cut
MIN_SPAN_S = 0.05       # spans shorter than this are noise (double slide press)


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
        [e for e in events if e.type == "slide" and e.slide is not None],
        key=lambda e: e.t,
    )
    stop = duration_s
    for e in events:
        if e.type == "stop":
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
