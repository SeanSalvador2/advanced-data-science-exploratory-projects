"""Every on-disk contract must survive a write/read round trip unchanged."""

from __future__ import annotations

import json
import os

import pytest

from lecture_rec.schemas import (
    MAX_EVENT_LINE_BYTES,
    BiasTerms,
    Event,
    EvalWindowMeta,
    Heartbeat,
    LectureDir,
    PageTerms,
    RecordingMeta,
    Segment,
    Transcript,
    Word,
    append_event,
    event_line,
    fmt_mmss,
    iso_delta_s,
    now_iso,
    read_events,
    read_json,
    tmp_path_for,
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

    start = Event(t=0.0, wall="w", type="start", source="recorder")
    assert start.to_dict() == {"t": 0.0, "wall": "w", "type": "start",
                               "source": "recorder"}


def test_app_written_event_has_no_t():
    """The browser app knows only the wall clock; `t` must be optional."""
    ev = Event(wall="2026-01-01T09:00:00.000+01:00", type="slide", slide=7,
               source="app")
    d = ev.to_dict()
    assert d == {"wall": "2026-01-01T09:00:00.000+01:00", "type": "slide",
                 "slide": 7, "source": "app"}
    assert "t" not in d
    assert Event.from_dict(d) == ev
    assert Event.from_dict(d).t is None


def test_event_lines_stay_under_the_append_limit():
    """One O_APPEND write of one short line is what keeps the app's writes and
    ours from interleaving, so a huge note must be truncated, not split."""
    ev = Event(t=1.0, wall="w", type="note", text="x" * 20000)
    line = event_line(ev)
    assert len(line.encode("utf-8")) <= MAX_EVENT_LINE_BYTES
    assert line.endswith("\n") and line.count("\n") == 1
    assert json.loads(line)["type"] == "note"


def test_append_event_is_one_write_per_line(tmp_path):
    p = tmp_path / "events.jsonl"
    append_event(p, Event(t=0.0, wall="w", type="start", source="recorder"))
    # An "app" writing between our two appends must not lose or split a line.
    with open(p, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"wall": "w2", "type": "slide", "slide": 2,
                             "source": "app"}) + "\n")
    append_event(p, Event(t=9.0, wall="w3", type="stop", source="recorder"))
    events = read_events(p)
    assert [e.type for e in events] == ["start", "slide", "stop"]
    assert [e.source for e in events] == ["recorder", "app", "recorder"]
    assert events[1].t is None


def test_iso_helpers_have_millisecond_resolution():
    now = now_iso()
    assert "." in now.split("T")[1], "startedWall needs milliseconds"
    assert iso_delta_s("2026-01-01T09:00:10.500+00:00",
                       "2026-01-01T09:00:00.000+00:00") == pytest.approx(10.5)
    # Offsets, not wall digits, decide the delta.
    assert iso_delta_s("2026-01-01T10:00:00.000+01:00",
                       "2026-01-01T09:00:00.000+00:00") == pytest.approx(0.0)
    assert iso_delta_s("2026-01-01T09:00:01.000Z",
                       "2026-01-01T09:00:00.000+00:00") == pytest.approx(1.0)


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


def test_recording_meta_is_written_camel_case_with_a_schema(tmp_path):
    m = RecordingMeta(started_wall="2026-01-01T09:00:00.250+00:00",
                      device="MacBook Mic")
    assert "durationS" not in m.to_dict(), "an unfinished recording has no duration"
    m.duration_s = 4512.25
    m.stopped_wall = "2026-01-01T10:15:12.500+00:00"
    p = tmp_path / "recording.json"
    write_json(p, m.to_dict())
    raw = read_json(p)
    assert raw["schema"] == "recording/1"
    assert set(raw) == {"schema", "startedWall", "stoppedWall", "durationS",
                        "sampleRate", "channels", "device", "file"}
    assert raw["sampleRate"] == 16000 and raw["file"] == "audio.wav"
    assert RecordingMeta.from_dict(raw) == m


def test_recording_meta_still_reads_the_phase_0_snake_case_form(tmp_path):
    """Folders recorded before the rename must still transcribe."""
    p = tmp_path / "recording.json"
    write_json(p, {
        "started_wall": "2026-01-01T09:00:00+00:00",
        "samplerate": 16000, "channels": 1, "file": "audio.wav",
        "device": "synthetic", "duration_s": 91.5,
    })
    m = RecordingMeta.from_dict(read_json(p))
    assert m.started_wall == "2026-01-01T09:00:00+00:00"
    assert m.sample_rate == 16000
    assert m.duration_s == 91.5
    assert m.stopped_wall is None
    # ...and it is re-written in the new spelling.
    assert m.to_dict()["schema"] == "recording/1"
    assert m.to_dict()["durationS"] == 91.5


def test_heartbeat_round_trip(tmp_path):
    hb = Heartbeat(pid=4242, started_wall="2026-01-01T09:00:00.000+00:00",
                   updated_wall="2026-01-01T09:00:04.000+00:00",
                   elapsed_s=4.0, rms_recent=0.031)
    p = tmp_path / ".lecture" / "heartbeat.json"
    write_json(p, hb.to_dict())
    raw = read_json(p)
    assert set(raw) == {"pid", "startedWall", "updatedWall", "elapsedS", "rmsRecent"}
    assert Heartbeat.from_dict(raw) == hb


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
    assert raw["schema"] == "bias/1"
    assert raw["global"] == ["argmax", "Wasserstein"]      # key is "global", not "global_terms"
    assert raw["pages"][0] == {"page": 1, "terms": ["KL divergence", "Wasserstein"]}
    assert BiasTerms.from_dict(raw) == b


def test_bias_terms_reading_tolerates_schema_and_derived_source():
    """`lecture bias` writes `schema` and source "derived"; both must read."""
    b = BiasTerms.from_dict({
        "schema": "bias/1", "deck": "deck.pdf", "source": "derived",
        "pages": [{"page": 1, "terms": ["Wasserstein"]}], "global": ["argmax"],
    })
    assert b.source == "derived"
    assert b.terms_for_slide(1) == ["Wasserstein"]


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
    assert raw["schema"] == "transcript/1"
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
    assert ld.transcript.as_posix().endswith("lec01/transcript.json")
    assert ld.heartbeat.as_posix().endswith("lec01/.lecture/heartbeat.json")
    assert ld.load_bias() == BiasTerms(pages=[], global_terms=[])
    assert ld.load_events() == []
    assert ld.load_recording() is None
    assert ld.load_transcript("plain") is None


def test_write_json_is_atomic_and_leaves_no_tmp(tmp_path):
    p = tmp_path / "a" / "b.json"
    write_json(p, {"x": 1})
    assert json.loads(p.read_text()) == {"x": 1}
    assert list(p.parent.iterdir()) == [p]


def test_tmp_path_is_hidden_and_in_the_same_directory(tmp_path):
    """Same directory so os.replace is an atomic rename; hidden and pid-tagged
    so no reader or second writer ever trips over it."""
    target = tmp_path / ".lecture" / "heartbeat.json"
    tmp = tmp_path_for(target)
    assert tmp.parent == target.parent
    assert tmp.name.startswith(".heartbeat.json.") and tmp.name.endswith(".tmp")
    assert str(os.getpid()) in tmp.name


def test_a_reader_never_sees_a_partial_json_file(tmp_path):
    """Rewrite the same file many times while reading it as fast as possible;
    every read must be either the old content or the new one."""
    import threading

    p = tmp_path / ".lecture" / "heartbeat.json"
    write_json(p, {"n": 0})
    bad: list[str] = []
    stop = threading.Event()

    def reader():
        while not stop.is_set():
            try:
                text = p.read_text(encoding="utf-8")
            except FileNotFoundError:
                bad.append("file vanished mid-write")
                continue
            try:
                json.loads(text)
            except json.JSONDecodeError:
                bad.append(repr(text[:80]))

    th = threading.Thread(target=reader, daemon=True)
    th.start()
    try:
        for n in range(1, 500):
            write_json(p, {"n": n, "pad": "x" * 4000})
    finally:
        stop.set()
        th.join(timeout=5)

    assert not bad, f"reader saw a partial file: {bad[:3]}"
    assert not [q for q in p.parent.iterdir() if q.name.endswith(".tmp")]
