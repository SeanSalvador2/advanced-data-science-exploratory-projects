"""Chunking: pieces are short enough, cover the span exactly, and cut on silence."""

from __future__ import annotations

import numpy as np
import pytest

from spike.chunking import (
    FRAME_S,
    Piece,
    SlideSpan,
    build_pieces,
    events_to_spans,
    frame_rms,
    slice_audio,
    split_span,
)
from spike.schemas import Event

SR = 16000


def make_audio(duration_s: float, quiet_at: list[tuple[float, float]] | None = None):
    rng = np.random.default_rng(0)
    n = int(duration_s * SR)
    audio = (rng.standard_normal(n) * 0.2).astype(np.float32)
    for a, b in (quiet_at or []):
        audio[int(a * SR): int(b * SR)] = 0.0
    return audio


def assert_covers(pieces, start, end):
    assert pieces, "no pieces produced"
    assert pieces[0][0] == pytest.approx(start)
    assert pieces[-1][1] == pytest.approx(end)
    for a, b in zip(pieces, pieces[1:]):
        assert a[1] == pytest.approx(b[0]), "gap or overlap between pieces"
    total = sum(b - a for a, b in pieces)
    assert total == pytest.approx(end - start)


@pytest.mark.parametrize("duration,max_piece", [(100.0, 28.0), (28.0, 28.0),
                                                (5.0, 28.0), (301.0, 30.0),
                                                (75.3, 12.0)])
def test_pieces_cover_span_and_respect_max(duration, max_piece):
    audio = make_audio(duration)
    rms = frame_rms(audio, SR)
    pieces = split_span(0.0, duration, rms, max_piece)
    assert_covers(pieces, 0.0, duration)
    for a, b in pieces:
        assert b - a <= max_piece + 1e-6, f"piece {a}-{b} longer than {max_piece}"
        assert b > a


def test_pieces_cover_an_offset_span():
    audio = make_audio(200.0)
    rms = frame_rms(audio, SR)
    pieces = split_span(37.5, 160.25, rms, 28.0)
    assert_covers(pieces, 37.5, 160.25)


def test_cut_lands_in_the_quiet_gap():
    # Silence at 24.0-25.0 s sits inside the search window [22, 28].
    audio = make_audio(60.0, quiet_at=[(24.0, 25.0)])
    rms = frame_rms(audio, SR)
    pieces = split_span(0.0, 60.0, rms, 28.0)
    cut = pieces[0][1]
    assert 24.0 <= cut <= 25.0, f"cut at {cut}, expected inside the silence"


def test_cut_prefers_the_quietest_frame_not_just_the_target():
    audio = make_audio(60.0, quiet_at=[(23.0, 23.2)])
    rms = frame_rms(audio, SR)
    pieces = split_span(0.0, 60.0, rms, 28.0)
    cut = pieces[0][1]
    assert 23.0 <= cut <= 23.2
    assert cut < 28.0 - 1.0


def test_frame_rms_shape_and_values():
    audio = np.concatenate([np.zeros(SR, dtype=np.float32),
                            np.ones(SR, dtype=np.float32) * 0.5])
    rms = frame_rms(audio, SR, FRAME_S)
    assert rms.size == 100
    assert rms[:50].max() == 0.0
    assert rms[50:].min() == pytest.approx(0.5, abs=1e-5)


# --------------------------------------------------------------------------- #
# events -> spans
# --------------------------------------------------------------------------- #


def ev(t, type_, slide=None, text=None):
    return Event(t=t, wall="2026-01-01T09:00:00+00:00", type=type_, slide=slide, text=text)


def test_events_to_spans_basic():
    events = [ev(0, "start"), ev(0, "slide", 1), ev(30, "slide", 2),
              ev(75, "slide", 3), ev(100, "stop")]
    spans = events_to_spans(events, 100.0)
    assert [(s.slide, s.start, s.end) for s in spans] == [
        (1, 0.0, 30.0), (2, 30.0, 75.0), (3, 75.0, 100.0)
    ]


def test_events_to_spans_marks_preroll_as_unknown_slide():
    events = [ev(0, "start"), ev(12.5, "slide", 1), ev(40, "slide", 2)]
    spans = events_to_spans(events, 60.0)
    assert spans[0].slide is None and spans[0].start == 0.0
    assert spans[0].end == pytest.approx(12.5)
    assert [s.slide for s in spans] == [None, 1, 2]
    assert spans[-1].end == pytest.approx(60.0)


def test_events_to_spans_without_events_is_one_unknown_span():
    spans = events_to_spans([], 42.0)
    assert len(spans) == 1
    assert spans[0].slide is None
    assert (spans[0].start, spans[0].end) == (0.0, 42.0)


def test_events_to_spans_drops_double_presses():
    events = [ev(0, "start"), ev(0, "slide", 1), ev(10, "slide", 2),
              ev(10.01, "slide", 3), ev(50, "stop")]
    spans = events_to_spans(events, 50.0)
    assert [s.slide for s in spans] == [1, 3]


def test_events_to_spans_ignores_notes():
    events = [ev(0, "start"), ev(0, "slide", 1), ev(5, "note", text="ask this"),
              ev(20, "slide", 2)]
    spans = events_to_spans(events, 40.0)
    assert [s.slide for s in spans] == [1, 2]


def test_spans_cover_the_whole_recording():
    events = [ev(0, "start"), ev(0, "slide", 1), ev(30, "slide", 2), ev(75, "slide", 3)]
    spans = events_to_spans(events, 120.0)
    assert sum(s.duration for s in spans) == pytest.approx(120.0)


# --------------------------------------------------------------------------- #
# build_pieces
# --------------------------------------------------------------------------- #


def test_build_pieces_carries_slide_numbers_and_indexes_globally():
    audio = make_audio(120.0)
    rms = frame_rms(audio, SR)
    spans = [SlideSpan(1, 0.0, 60.0), SlideSpan(2, 60.0, 120.0)]
    pieces = build_pieces(spans, rms, 28.0)
    assert [p.index for p in pieces] == list(range(len(pieces)))
    assert {p.slide for p in pieces} == {1, 2}
    for p in pieces:
        assert p.duration <= 28.0 + 1e-6
    starts = [p.start for p in pieces]
    assert starts == sorted(starts)
    assert sum(p.duration for p in pieces) == pytest.approx(120.0)


def test_build_pieces_is_deterministic_so_conditions_match():
    audio = make_audio(90.0, quiet_at=[(20.0, 20.4), (45.0, 45.4)])
    rms = frame_rms(audio, SR)
    spans = events_to_spans(
        [ev(0, "start"), ev(0, "slide", 1), ev(45, "slide", 2)], 90.0
    )
    a = build_pieces(spans, rms, 28.0)
    b = build_pieces(spans, rms, 28.0)
    assert [(p.index, p.slide, p.start, p.end) for p in a] == \
           [(p.index, p.slide, p.start, p.end) for p in b]


def test_slice_audio_bounds():
    audio = make_audio(10.0)
    assert slice_audio(audio, SR, 1.0, 2.0).size == SR
    assert slice_audio(audio, SR, 9.5, 100.0).size == SR // 2
    assert slice_audio(audio, SR, 5.0, 5.0).size == 0
