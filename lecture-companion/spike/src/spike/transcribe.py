"""Drive an engine over the pieces of one lecture, once per condition.

Pieces are computed once from (events, audio) and reused for every condition,
so plain and biased differ ONLY in the prompt. Each condition's JSON is
rewritten after every slide, so a crash 50 minutes in keeps the work.
"""

from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Iterable, Optional

import numpy as np

from .chunking import (
    Piece,
    build_pieces,
    events_to_spans,
    frame_rms,
    load_audio,
    slice_audio,
)
from .engines import Engine, select_engine
from .schemas import (
    LectureDir,
    Segment,
    Transcript,
    Word,
    fmt_mmss,
    now_iso,
    write_json,
)
from .terms import build_prompt

PROMPT_MAX_WORDS = 60
ECHO_MIN_WORDS = 6

_PUNCT = re.compile(r"[^\w']+", re.UNICODE)


def _norm_word(w: str) -> str:
    return _PUNCT.sub("", w).lower()


def strip_prompt_echo(
    text: str, prompt: str, min_words: int = ECHO_MIN_WORDS
) -> tuple[str, str]:
    """Drop a leading verbatim echo of the prompt.

    Returns (cleaned_text, echoed_prefix). The prefix is only dropped when at
    least `min_words` leading words of the text match the leading words of the
    prompt, so a genuine sentence that happens to start with one bias term is
    left alone.
    """
    if not prompt or not text:
        return text, ""
    prompt_words = [_norm_word(w) for w in prompt.split()]
    raw_words = text.split()
    text_words = [_norm_word(w) for w in raw_words]

    matched = 0
    for i in range(min(len(prompt_words), len(text_words))):
        if text_words[i] and text_words[i] == prompt_words[i]:
            matched = i + 1
        else:
            break

    if matched >= min_words:
        rest = " ".join(raw_words[matched:]).lstrip(" ,.;:-—")
        return rest, " ".join(raw_words[:matched])
    return text, ""


def prompt_for_piece(piece: Piece, bias) -> str:
    """Per-slide terms, falling back to the global list, capped at 60 words."""
    return build_prompt(bias.terms_for_slide(piece.slide), PROMPT_MAX_WORDS)


def _write_condition(ld: LectureDir, transcript: Transcript) -> None:
    write_json(ld.transcript_json(transcript.condition), transcript.to_dict())
    ld.transcript_txt(transcript.condition).write_text(
        transcript.to_text(), encoding="utf-8"
    )


def transcribe_pieces(
    engine: Engine,
    audio: np.ndarray,
    sr: int,
    pieces: Iterable[Piece],
    bias,
    condition: str,
    ld: LectureDir,
    resume: bool = False,
    verbose: bool = True,
) -> Transcript:
    pieces = list(pieces)
    existing: dict[int, Segment] = {}
    if resume:
        prev = ld.load_transcript(condition)
        if prev is not None:
            existing = {s.id: s for s in prev.segments}
            if verbose and existing:
                print(f"  resume: {len(existing)} piece(s) already done")

    transcript = Transcript(
        engine=engine.name,
        model=engine.model_name,
        condition=condition,  # type: ignore[arg-type]
        created=now_iso(),
        segments=[],
    )

    t0 = time.monotonic()
    audio_done = 0.0
    last_slide: object = object()

    for piece in pieces:
        if piece.slide != last_slide and transcript.segments:
            _write_condition(ld, transcript)          # flush at every slide change
        last_slide = piece.slide

        if piece.index in existing:
            transcript.segments.append(existing[piece.index])
            audio_done += piece.duration
            continue

        prompt = prompt_for_piece(piece, bias) if condition == "biased" else ""
        chunk = slice_audio(audio, sr, piece.start, piece.end)
        p0 = time.monotonic()
        result = engine.transcribe_piece(chunk, sr, prompt)
        took = time.monotonic() - p0

        text, echo = strip_prompt_echo(result.text, prompt)
        if echo and verbose:
            print(f"    [prompt echo stripped] {echo[:70]}")

        words = [
            Word(w=w, start=piece.start + s, end=piece.start + e)
            for (w, s, e) in result.words
        ]
        if echo:
            # Word timings for the echoed prefix are meaningless; drop that many.
            words = words[len(echo.split()):]

        transcript.segments.append(
            Segment(
                id=piece.index,
                slide=piece.slide,
                start=piece.start,
                end=piece.end,
                prompt=prompt,
                text=text.strip(),
                words=words,
            )
        )
        audio_done += piece.duration

        if verbose:
            elapsed = time.monotonic() - t0
            rtf = took / piece.duration if piece.duration > 0 else 0.0
            slide = "-" if piece.slide is None else piece.slide
            print(
                f"  [{piece.index + 1}/{len(pieces)}] slide {slide} "
                f"{fmt_mmss(piece.start)}-{fmt_mmss(piece.end)} "
                f"({piece.duration:4.1f}s) rtf {rtf:4.2f} "
                f"elapsed {fmt_mmss(elapsed)}"
            )

    transcript.segments.sort(key=lambda s: s.start)
    _write_condition(ld, transcript)

    if verbose:
        elapsed = time.monotonic() - t0
        overall = elapsed / audio_done if audio_done > 0 else 0.0
        print(
            f"  {condition}: {len(transcript.segments)} segments, "
            f"{fmt_mmss(audio_done)} audio in {fmt_mmss(elapsed)} "
            f"(rtf {overall:.2f}) -> {ld.transcript_json(condition)}"
        )
    return transcript


def run_transcribe(
    dir_path: str | Path,
    engine_name: str = "auto",
    model: Optional[str] = None,
    conditions: Optional[list[str]] = None,
    max_piece_s: float = 28.0,
    resume: bool = False,
) -> dict[str, Transcript]:
    ld = LectureDir(dir_path)
    if not ld.audio.exists():
        raise SystemExit(f"no audio at {ld.audio}")

    conditions = conditions or ["plain", "biased"]
    for c in conditions:
        if c not in ("plain", "biased"):
            raise SystemExit(f"unknown condition {c!r}; use plain and/or biased")

    audio, sr = load_audio(ld.audio)
    duration = audio.size / float(sr)
    events = ld.load_events()
    bias = ld.load_bias()

    if not events:
        print("no events.jsonl: treating the whole file as one segment (global terms)")
    spans = events_to_spans(events, duration)
    rms_frames = frame_rms(audio, sr)
    pieces = build_pieces(spans, rms_frames, max_piece_s)

    print(
        f"audio {fmt_mmss(duration)} | {len(spans)} slide span(s) | "
        f"{len(pieces)} piece(s) <= {max_piece_s:g}s"
    )

    eng = select_engine(engine_name, model)
    print(f"engine {eng.name} | model {eng.model_name}")

    out: dict[str, Transcript] = {}
    for condition in conditions:
        if condition == "biased" and not eng.supports_bias:
            print(
                f"note: {eng.name} has no prompt/bias input - skipping the biased "
                "condition. Compare plain-vs-plain against a Whisper engine instead."
            )
            continue
        if condition == "biased" and not (bias.global_terms or bias.pages):
            print("note: bias.json has no terms; the biased run would equal the plain "
                  "one. Run `spike terms --deck ...` first.")
        print(f"condition: {condition}")
        out[condition] = transcribe_pieces(
            eng, audio, sr, pieces, bias, condition, ld, resume=resume
        )
    return out
