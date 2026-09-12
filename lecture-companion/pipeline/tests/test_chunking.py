"""Chunking: pieces are short enough, cover the span exactly, and cut on silence."""

from __future__ import annotations

import numpy as np
import pytest

from lecture_rec.chunking import (
    EVENT_SLACK_S,
    FRAME_S,
    Piece,
    SlideSpan,
    build_pieces,
    clip_spans_to_take,
    events_to_spans,
    frame_rms,
    normalize_events,
    slice_audio,
    split_span,
)
from lecture_rec.schemas import Event

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
# app events -> the audio clock
# --------------------------------------------------------------------------- #

START = "2026-01-01T09:00:00.000+00:00"


def app_ev(wall, type_, slide=None, text=None):
    """An event as the browser app writes it: a wall clock and no `t`."""
    return Event(wall=wall, type=type_, slide=slide, text=text, source="app")


def wall_at(offset_s: float) -> str:
    from datetime import timedelta

    from lecture_rec.schemas import parse_iso

    return (parse_iso(START) + timedelta(seconds=offset_s)).isoformat(
        timespec="milliseconds")


def test_app_events_are_projected_onto_the_audio_clock():
    events = [
        Event(t=0.0, wall=START, type="start", source="recorder"),
        app_ev(wall_at(12.5), "slide", 1),
        app_ev(wall_at(70.25), "note", text="exam hint"),
        app_ev(wall_at(90.0), "slide", 2),
        Event(t=120.0, wall=wall_at(120.0), type="stop", source="recorder"),
    ]
    out = normalize_events(events, START, 120.0)
    assert [round(e.t, 3) for e in out] == [0.0, 12.5, 70.25, 90.0, 120.0]
    assert [e.type for e in out] == ["start", "slide", "note", "slide", "stop"]
    # A supplied `t` is authoritative and is never recomputed.
    assert out[0].t == 0.0 and out[-1].t == 120.0


def test_a_supplied_t_wins_over_the_wall_clock():
    events = [Event(t=5.0, wall=wall_at(999.0), type="slide", slide=3,
                    source="recorder")]
    assert normalize_events(events, START, 60.0)[0].t == 5.0


def test_events_outside_the_audio_are_dropped_and_named():
    warnings: list[str] = []
    events = [
        Event(t=0.0, wall=START, type="start", source="recorder"),
        app_ev(wall_at(-30.0), "slide", 1),                 # before frame 0
        app_ev(wall_at(10.0), "slide", 2),                  # fine
        app_ev(wall_at(60.0 + EVENT_SLACK_S + 1.0), "slide", 3),   # after the end
    ]
    out = normalize_events(events, START, 60.0, warn=warnings.append)
    assert [e.slide for e in out if e.type == "slide"] == [2]
    assert len(warnings) == 1
    assert "slide 1" in warnings[0] and "slide 3" in warnings[0]
    assert "dropped 2 event(s)" in warnings[0]


def test_an_event_just_inside_the_slack_survives():
    events = [app_ev(wall_at(60.0 + EVENT_SLACK_S - 0.5), "slide", 9)]
    assert [e.slide for e in normalize_events(events, START, 60.0)] == [9]


def test_events_are_sorted_by_audio_time():
    """The app and the recorder append independently, so the file need not be
    in time order; the slide spans depend on it being sorted."""
    events = [
        app_ev(wall_at(90.0), "slide", 3),
        Event(t=0.0, wall=START, type="start", source="recorder"),
        app_ev(wall_at(30.0), "slide", 2),
        app_ev(wall_at(5.0), "slide", 1),
    ]
    out = normalize_events(events, START, 120.0)
    assert [e.slide for e in out if e.type == "slide"] == [1, 2, 3]
    spans = events_to_spans(out, 120.0)
    assert [s.slide for s in spans] == [None, 1, 2, 3]


def test_without_recording_meta_the_start_event_is_the_origin():
    events = [
        Event(t=0.0, wall=START, type="start", source="recorder"),
        app_ev(wall_at(42.0), "slide", 1),
    ]
    out = normalize_events(events, None, 120.0)
    assert [round(e.t, 3) for e in out] == [0.0, 42.0]


def test_undatable_events_are_dropped_with_a_warning():
    warnings: list[str] = []
    events = [app_ev(wall_at(10.0), "slide", 4)]     # no `t`, no origin anywhere
    out = normalize_events(events, None, 120.0, warn=warnings.append)
    assert out == []
    assert "no usable time" in warnings[0] and "slide 4" in warnings[0]


def test_recorder_only_events_pass_through_unchanged():
    events = [ev(0, "start"), ev(30, "slide", 2), ev(100, "stop")]
    assert normalize_events(events, None, 100.0) == events


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


# --------------------------------------------------------------------------- #
# takes: spans on the lecture clock, audio in per-take files
# --------------------------------------------------------------------------- #


def test_clip_spans_to_take_keeps_only_what_that_take_recorded():
    """Take 2 starts 80 s into the lecture and runs for 40 s."""
    spans = [SlideSpan(1, 0.0, 50.0),        # all of it is take 1
             SlideSpan(2, 50.0, 100.0),      # straddles the gap and take 2's start
             SlideSpan(3, 100.0, 120.0)]     # all of it is take 2
    got = clip_spans_to_take(spans, offset=80.0, duration_s=40.0)
    assert [(s.slide, s.start, s.end) for s in got] == [(2, 0.0, 20.0),
                                                        (3, 20.0, 40.0)]


def test_clip_spans_to_take_is_a_no_op_for_a_single_take_lecture():
    spans = events_to_spans(
        [ev(0, "start"), ev(0, "slide", 1), ev(45, "slide", 2)], 90.0)
    assert clip_spans_to_take(spans, 0.0, 90.0) == spans


def test_clip_spans_to_take_drops_slivers_and_the_gap():
    spans = [SlideSpan(1, 0.0, 80.0), SlideSpan(2, 80.0, 120.0)]
    # Take 2 is the last 40 s; slide 1 only overlaps it by a hair.
    got = clip_spans_to_take(spans, offset=79.99, duration_s=40.01)
    assert [s.slide for s in got] == [2]


def test_build_pieces_puts_a_takes_pieces_on_the_lecture_clock():
    audio = make_audio(40.0)
    rms = frame_rms(audio, SR)
    spans = [SlideSpan(4, 0.0, 40.0)]
    pieces = build_pieces(spans, rms, 28.0, take=2, offset=80.0, start_index=3)
    assert [p.index for p in pieces] == [3, 4]
    assert all(p.take == 2 and p.offset == 80.0 for p in pieces)
    assert pieces[0].start == pytest.approx(80.0)
    assert pieces[-1].end == pytest.approx(120.0)
    # ...while the audio to slice still lives at the take's own times.
    assert pieces[0].local_start == pytest.approx(0.0)
    assert pieces[-1].local_end == pytest.approx(40.0)
    assert sum(p.duration for p in pieces) == pytest.approx(40.0)


def test_a_piece_of_take_one_is_its_own_local_time():
    p = Piece(0, 1, 3.0, 9.0)
    assert p.take == 1 and p.offset == 0.0
    assert (p.local_start, p.local_end) == (3.0, 9.0)
