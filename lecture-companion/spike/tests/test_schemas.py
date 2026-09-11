"""Every on-disk contract must survive a write/read round trip unchanged."""

from __future__ import annotations

import json

import pytest

from spike.schemas import (
    BiasTerms,
    Event,
    EvalWindowMeta,
    LectureDir,
    PageTerms,
    RecordingMeta,
    Segment,
    Transcript,
    Word,
    append_event,
    fmt_mmss,
    read_events,
    read_json,
    write_json,
)


def test_event_round_trip_and_optional_fields():
    slide = Event(t=12.5, wall="2026-01-01T09:00:00+01:00", type="slide", slide=7)
    d = slide.to_dict()
    assert d == {"t": 12.5, "wall": "2026-01-01T09:00:00+01:00",
                 "type": "slide", "slide": 7}
    assert "text" not in d
    assert Event.from_dict(d) == slide

    note = Event(t=1.0, wall="w", type="note", text="he said this matters")
    assert note.to_dict() == {"t": 1.0, "wall": "w", "type": "note",
                              "text": "he said this matters"}
    assert Event.from_dict(note.to_dict()) == note

    start = Event(t=0.0, wall="w", type="start")
    assert start.to_dict() == {"t": 0.0, "wall": "w", "type": "start"}


def test_events_jsonl_round_trip(tmp_path):
    p = tmp_path / "events.jsonl"
    events = [
        Event(t=0.0, wall="w", type="start"),
        Event(t=0.0, wall="w", type="slide", slide=1),
        Event(t=31.2, wall="w", type="note", text="exam hint"),
        Event(t=90.0, wall="w", type="stop"),
    ]
    for e in events:
        append_event(p, e)
    assert read_events(p) == events
    assert len(p.read_text().strip().splitlines()) == 4


def test_recording_meta_round_trip(tmp_path):
    m = RecordingMeta(started_wall="2026-01-01T09:00:00+00:00", device="MacBook Mic")
    assert m.to_dict()["duration_s"] is None
    m.duration_s = 4512.25
    p = tmp_path / "recording.json"
    write_json(p, m.to_dict())
    assert RecordingMeta.from_dict(read_json(p)) == m
    assert set(read_json(p)) == {"started_wall", "samplerate", "channels",
                                 "file", "device", "duration_s"}


def test_bias_terms_round_trip_and_global_key(tmp_path):
    b = BiasTerms(
        deck="deck.pdf", source="claude",
        pages=[PageTerms(1, ["KL divergence", "Wasserstein"]),
               PageTerms(2, ["theta hat"])],
        global_terms=["argmax", "Wasserstein"],
    )
    p = tmp_path / "bias.json"
    write_json(p, b.to_dict())
    raw = read_json(p)
    assert raw["global"] == ["argmax", "Wasserstein"]      # key is "global", not "global_terms"
    assert raw["pages"][0] == {"page": 1, "terms": ["KL divergence", "Wasserstein"]}
    assert BiasTerms.from_dict(raw) == b


def test_bias_terms_caps_are_enforced_on_write():
    b = BiasTerms(pages=[PageTerms(1, [f"t{i}" for i in range(80)])],
                  global_terms=[f"g{i}" for i in range(120)])
    d = b.to_dict()
    assert len(d["pages"][0]["terms"]) == 40
    assert len(d["global"]) == 60


def test_terms_for_slide_falls_back_to_global():
    b = BiasTerms(pages=[PageTerms(3, ["Wasserstein"])], global_terms=["argmax"])
    assert b.terms_for_slide(3) == ["Wasserstein"]
    assert b.terms_for_slide(9) == ["argmax"]
    assert b.terms_for_slide(None) == ["argmax"]


def test_transcript_round_trip(tmp_path):
    t = Transcript(
        engine="faster-whisper", model="large-v3-turbo", condition="biased",
        created="2026-01-01T09:00:00+00:00",
        segments=[
            Segment(id=0, slide=1, start=0.0, end=27.5, prompt="argmax, theta hat",
                    text="the argmax of theta hat",
                    words=[Word("the", 0.0, 0.2), Word("argmax", 0.2, 0.9)]),
            Segment(id=1, slide=None, start=27.5, end=40.0, prompt="",
                    text="", words=[]),
        ],
    )
    p = tmp_path / "biased.json"
    write_json(p, t.to_dict())
    back = Transcript.from_dict(read_json(p))
    assert back == t
    raw = read_json(p)
    assert raw["segments"][1]["slide"] is None
    assert set(raw["segments"][0]) == {"id", "slide", "start", "end", "prompt",
                                       "text", "words"}
    assert set(raw["segments"][0]["words"][0]) == {"w", "start", "end"}


def test_transcript_text_form():
    t = Transcript("e", "m", "plain", "c", segments=[
        Segment(id=0, slide=7, start=723.0, end=751.0, prompt="", text="hello there"),
        Segment(id=1, slide=None, start=751.0, end=760.0, prompt="", text="and again"),
    ])
    lines = t.to_text().splitlines()
    assert lines[0] == "[slide 7 | 12:03-12:31] hello there"
    assert lines[1] == "[slide - | 12:31-12:40] and again"


def test_eval_window_meta_round_trip(tmp_path):
    m = EvalWindowMeta(index=2, start=1200.0, end=1500.0, slides=[12, 13, 14])
    p = tmp_path / "meta.json"
    write_json(p, m.to_dict())
    assert EvalWindowMeta.from_dict(read_json(p)) == m
    assert set(read_json(p)) == {"index", "start", "end", "slides"}


@pytest.mark.parametrize("s,expected", [(0, "00:00"), (59.4, "00:59"), (60, "01:00"),
                                        (723, "12:03"), (4512, "75:12"), (-5, "00:00")])
def test_fmt_mmss(s, expected):
    assert fmt_mmss(s) == expected


def test_lecture_dir_paths(tmp_path):
    ld = LectureDir(tmp_path / "lec01")
    assert ld.audio.name == "audio.wav"
    assert ld.events.name == "events.jsonl"
    assert ld.transcript_json("plain").as_posix().endswith("transcripts/plain.json")
    assert ld.transcript_txt("biased").as_posix().endswith("transcripts/biased.txt")
    assert ld.window(3).as_posix().endswith("eval/window-3")
    assert ld.load_bias() == BiasTerms(pages=[], global_terms=[])
    assert ld.load_events() == []
    assert ld.load_recording() is None
    assert ld.load_transcript("plain") is None


def test_write_json_is_atomic_and_leaves_no_tmp(tmp_path):
    p = tmp_path / "a" / "b.json"
    write_json(p, {"x": 1})
    assert json.loads(p.read_text()) == {"x": 1}
    assert list(p.parent.iterdir()) == [p]
