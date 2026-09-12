"""Recorder behaviour, driven by a fake input stream and a scripted stdin.

There is no microphone in CI, so the stream is injected. The fake stream pushes
frames synchronously from the same thread that feeds commands, which makes the
audio clock - and therefore every event timestamp - exactly predictable.

Two modes are covered: the default one, where the browser app owns slide and
note events and the recorder writes only `start`/`stop` plus the heartbeat,
and `--keys`, which reproduces the Phase 0 keyboard protocol.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from lecture_rec.record import FLUSH_INTERVAL_S, RMS_WINDOW_S, SILENCE_RMS, Recorder
from lecture_rec.schemas import (
    HEARTBEAT_INTERVAL_S,
    Heartbeat,
    LectureDir,
    read_events,
    read_json,
    tmp_path_for,
)

SR = 16000
NODE_CLI = Path(__file__).resolve().parents[2] / "cli" / "bin" / "lecture.mjs"


def wait_until(pred, timeout: float = 10.0) -> bool:
    """Poll `pred` until it is true (the heartbeat lives on its own thread)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if pred():
                return True
        except (FileNotFoundError, KeyError, json.JSONDecodeError):
            pass
        time.sleep(0.01)
    return False


class FakeStream:
    """Stands in for sounddevice.InputStream. Produces audio only on demand."""

    def __init__(self, callback, samplerate, channels, device):
        self.callback = callback
        self.samplerate = samplerate
        self.channels = channels
        self.device = device
        self.started = False
        self.stopped = False
        self.closed = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def close(self):
        self.closed = True

    def advance(self, seconds: float, amplitude: float = 0.1) -> None:
        """Push `seconds` of audio through the callback, synchronously."""
        n = int(round(seconds * self.samplerate))
        if amplitude == 0.0:
            block = np.zeros((n, self.channels), dtype=np.float32)
        else:
            t = np.arange(n, dtype=np.float32) / self.samplerate
            tone = (amplitude * np.sin(2 * np.pi * 220.0 * t)).astype(np.float32)
            block = np.repeat(tone[:, None], self.channels, axis=1)
        self.callback(block)


@pytest.fixture
def rig(tmp_path):
    """A recorder wired to a FakeStream, plus a captured output log."""
    holder: dict = {}
    log: list[str] = []

    def factory(callback, samplerate, channels, device):
        stream = FakeStream(callback, samplerate, channels, device)
        holder["stream"] = stream
        return stream

    def make(script, **kwargs):
        rec = Recorder(
            tmp_path / "lec",
            stream_factory=factory,
            line_source=script(holder, log),
            out=log.append,
            **kwargs,
        )
        return rec, holder, log

    return make


def test_default_mode_writes_only_start_and_stop(rig):
    """The app owns slide and note events now; Enter here must write nothing."""
    def script(holder, log):
        holder["stream"].advance(10.0)
        yield ""                             # Phase 0 habit: must be ignored
        holder["stream"].advance(20.0)
        yield "17"                           # so must this
        holder["stream"].advance(18.0)
        yield "q"                            # stop at 48 s

    rec, holder, log = rig(script)
    rec.run()

    ld = LectureDir(rec.ld.root)
    events = read_events(ld.events)
    assert [(e.type, round(e.t, 3), e.source) for e in events] == [
        ("start", 0.0, "recorder"),
        ("stop", 48.0, "recorder"),
    ]
    assert all(e.wall for e in events)
    assert any("mode: app" in line for line in log), "must say which mode it is in"

    info = sf.info(str(ld.audio))
    assert info.samplerate == SR and info.channels == 1
    assert info.frames == 48 * SR and info.subtype == "PCM_16"

    meta = read_json(ld.recording)
    assert meta["schema"] == "recording/1"
    assert meta["durationS"] == pytest.approx(48.0)
    assert meta["sampleRate"] == SR and meta["channels"] == 1
    assert meta["file"] == "audio.wav"
    assert meta["startedWall"] == events[0].wall
    assert meta["stoppedWall"] == events[-1].wall
    assert holder["stream"].started and holder["stream"].stopped


def test_keys_mode_reproduces_the_phase_0_event_stream(rig):
    def script(holder, log):
        holder["stream"].advance(10.0)       # 10 s on slide 1
        yield ""                             # -> slide 2
        holder["stream"].advance(20.0)
        yield ""                             # -> slide 3
        holder["stream"].advance(5.0)
        yield "n check this derivation"      # note at 35 s
        holder["stream"].advance(5.0)
        yield "b"                            # back to slide 2 at 40 s
        holder["stream"].advance(5.0)
        yield "17"                           # jump to slide 17 at 45 s
        holder["stream"].advance(3.0)
        yield "q"                            # stop at 48 s

    rec, holder, log = rig(script, keys=True)
    rec.run()

    events = read_events(rec.ld.events)
    got = [(e.type, round(e.t, 3), e.slide, e.text) for e in events]
    assert got == [
        ("start", 0.0, None, None),
        ("slide", 0.0, 1, None),
        ("slide", 10.0, 2, None),
        ("slide", 30.0, 3, None),
        ("note", 35.0, None, "check this derivation"),
        ("slide", 40.0, 2, None),
        ("slide", 45.0, 17, None),
        ("stop", 48.0, None, None),
    ]
    assert {e.source for e in events} == {"recorder"}
    assert all(e.t is not None and e.wall for e in events)
    assert any("mode: --keys" in line for line in log)


def test_recording_json_validates_against_the_typescript_contract(rig):
    """The Node CLI validates against packages/core, the source of truth."""
    if shutil.which("node") is None:
        pytest.skip("node is not installed; cannot cross-check the TS contract")
    if not NODE_CLI.exists():
        pytest.skip(f"{NODE_CLI} is not built; run `npm run build` in lecture-companion")

    def script(holder, log):
        holder["stream"].advance(2.0)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()

    out = subprocess.run(
        ["node", str(NODE_CLI), "validate", str(rec.ld.recording)],
        capture_output=True, text=True,
    )
    assert out.returncode == 0, out.stdout + out.stderr
    assert "ok" in out.stdout and "recording/1" in out.stdout


def test_heartbeat_is_written_advances_and_is_removed_on_stop(rig):
    seen: dict = {}

    def script(holder, log):
        rec = seen["rec"]
        assert rec.ld.heartbeat.exists(), "the heartbeat exists from the first moment"
        holder["stream"].advance(3.0, amplitude=0.2)
        assert wait_until(lambda: read_json(rec.ld.heartbeat)["elapsedS"] >= 3.0)
        seen["first"] = read_json(rec.ld.heartbeat)
        holder["stream"].advance(5.0, amplitude=0.2)
        assert wait_until(lambda: read_json(rec.ld.heartbeat)["elapsedS"] >= 8.0)
        seen["second"] = read_json(rec.ld.heartbeat)
        yield "q"

    rec, holder, log = rig(script, heartbeat_interval_s=0.02)
    seen["rec"] = rec
    rec.run()

    first, second = seen["first"], seen["second"]
    for hb in (first, second):
        assert set(hb) == {"pid", "startedWall", "updatedWall", "elapsedS", "rmsRecent"}
        assert hb["pid"] == os.getpid()
        assert hb["startedWall"] == read_json(rec.ld.recording)["startedWall"]
        assert Heartbeat.from_dict(hb)               # shape holds
    assert second["elapsedS"] > first["elapsedS"], "elapsedS must track the audio clock"
    assert second["elapsedS"] == pytest.approx(8.0, abs=0.5)
    assert second["updatedWall"] >= first["updatedWall"]
    assert second["rmsRecent"] > 0.1, "a 0.2-amplitude tone is about 0.14 rms"

    assert not rec.ld.heartbeat.exists(), "a clean stop removes the heartbeat"
    assert rec.ld.dot_lecture.exists()
    assert list(rec.ld.dot_lecture.iterdir()) == []


def test_heartbeat_reports_recent_silence_not_the_whole_recording(rig):
    def script(holder, log):
        holder["stream"].advance(10.0, amplitude=0.3)     # loud, then quiet
        holder["stream"].advance(RMS_WINDOW_S + 1.0, amplitude=0.0)
        yield "q"

    rec, holder, log = rig(script, heartbeat_interval_s=0.02)
    rec.run()                                   # heartbeat is gone after stop
    assert rec.rms_recent() == pytest.approx(0.0, abs=1e-6)


def test_heartbeat_is_never_observably_partial(rig):
    """A reader polling the heartbeat sees either the old file or the new one."""
    bad: list[str] = []
    stop = threading.Event()
    seen: dict = {}

    def reader(path):
        while not stop.is_set():
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except FileNotFoundError:
                pass                                  # before start / after stop
            except json.JSONDecodeError as exc:
                bad.append(f"{exc}")

    def script(holder, log):
        rec = seen["rec"]
        th = threading.Thread(target=reader, args=(rec.ld.heartbeat,), daemon=True)
        seen["thread"] = th
        th.start()
        for _ in range(20):
            holder["stream"].advance(1.0, amplitude=0.2)
            time.sleep(0.01)
        yield "q"

    rec, holder, log = rig(script, heartbeat_interval_s=0.001)
    seen["rec"] = rec
    try:
        rec.run()
    finally:
        stop.set()
        seen["thread"].join(timeout=5)

    assert not bad, f"reader saw a partial heartbeat: {bad[:3]}"
    # ...and the temp file it went through is gone, and was never the real name.
    tmp = tmp_path_for(rec.ld.heartbeat)
    assert tmp.name.startswith(".heartbeat.json.") and tmp.name.endswith(".tmp")
    assert not tmp.exists()


def test_heartbeat_interval_is_two_seconds():
    assert HEARTBEAT_INTERVAL_S == 2.0


def test_event_times_come_from_the_audio_clock_not_wall_clock(rig, monkeypatch):
    """Freeze wall time entirely: event `t` must still advance with the audio."""
    monkeypatch.setattr("lecture_rec.record.now_iso",
                        lambda: "2026-01-01T09:00:00.000+00:00")

    def script(holder, log):
        holder["stream"].advance(7.5)
        yield ""
        holder["stream"].advance(12.25)
        yield "q"

    rec, holder, log = rig(script, keys=True)
    rec.run()
    events = read_events(rec.ld.events)
    assert {e.wall for e in events} == {"2026-01-01T09:00:00.000+00:00"}
    assert [round(e.t, 3) for e in events] == [0.0, 0.0, 7.5, 19.75]


def test_ctrl_c_stops_cleanly_and_finalises_everything(rig):
    def script(holder, log):
        holder["stream"].advance(6.0)
        yield ""
        holder["stream"].advance(4.0)
        raise KeyboardInterrupt

    rec, holder, log = rig(script)
    rec.run()                                   # must not propagate

    events = read_events(rec.ld.events)
    assert events[-1].type == "stop"
    assert events[-1].t == pytest.approx(10.0)
    assert read_json(rec.ld.recording)["durationS"] == pytest.approx(10.0)
    assert sf.info(str(rec.ld.audio)).duration == pytest.approx(10.0)
    assert not rec.ld.heartbeat.exists()
    assert holder["stream"].closed


def test_silence_triggers_a_loud_warning_that_repeats(rig):
    def script(holder, log):
        holder["stream"].advance(6.0, amplitude=0.0)     # first check at 5 s
        yield ""
        holder["stream"].advance(31.0, amplitude=0.0)    # repeat check at ~36 s
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    warnings = [line for line in log if "SILENT INPUT" in line]
    assert len(warnings) == 2, "should re-warn about every 30 s while silent"
    assert "Terminal.app" in warnings[0]
    assert "Privacy & Security" in warnings[0]


def test_warning_stops_once_audio_is_detected(rig):
    def script(holder, log):
        holder["stream"].advance(6.0, amplitude=0.0)     # silent -> warn
        yield ""
        holder["stream"].advance(31.0, amplitude=0.2)    # audio -> detected
        yield ""
        holder["stream"].advance(60.0, amplitude=0.0)    # silent again -> no warning
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    assert sum("SILENT INPUT" in line for line in log) == 1
    assert any("audio detected" in line for line in log)


def test_loud_audio_never_warns(rig):
    def script(holder, log):
        holder["stream"].advance(40.0, amplitude=0.3)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    assert not any("SILENT INPUT" in line for line in log)


def test_recording_never_aborts_on_silence(rig):
    def script(holder, log):
        holder["stream"].advance(120.0, amplitude=0.0)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    assert sf.info(str(rec.ld.audio)).duration == pytest.approx(120.0)


def test_wav_is_playable_before_stop(rig):
    """Flushing means a crash mid-lecture still leaves a readable, playable file."""
    import time

    seen: dict = {}

    def script(holder, log):
        holder["stream"].advance(12.0)
        yield ""
        rec = seen["rec"]
        deadline = time.monotonic() + 10.0
        while rec._file.tell() < 12 * SR and time.monotonic() < deadline:
            time.sleep(0.01)
        rec._file.flush()
        # Nothing has been closed yet, yet the file on disk is already readable.
        info = sf.info(str(rec.ld.audio))
        seen["frames_on_disk"] = info.frames
        seen["read_back"], _ = sf.read(str(rec.ld.audio), dtype="float32")
        yield "q"

    rec, holder, log = rig(script, flush_interval_s=1.0)
    seen["rec"] = rec
    rec.run()
    assert seen["frames_on_disk"] >= 12 * SR
    assert np.abs(seen["read_back"]).max() > 0.0


def test_flush_interval_is_at_most_five_seconds():
    assert FLUSH_INTERVAL_S <= 5.0


def test_caffeinate_is_not_started_off_darwin(rig):
    def script(holder, log):
        holder["stream"].advance(1.0)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    if platform.system() == "Darwin":               # pragma: no cover
        assert rec._caffeinate is not None
    else:
        assert rec._caffeinate is None
        assert not any("stay awake" in line for line in log)


def test_unknown_command_is_reported_and_ignored(rig):
    def script(holder, log):
        holder["stream"].advance(2.0)
        yield "wat"
        yield "q"

    rec, holder, log = rig(script, keys=True)
    rec.run()
    assert any("unknown command" in line for line in log)
    slides = [e for e in read_events(rec.ld.events) if e.type == "slide"]
    assert [e.slide for e in slides] == [1]


def test_default_mode_says_how_to_get_the_keyboard_protocol(rig):
    def script(holder, log):
        holder["stream"].advance(1.0)
        yield "n this note belongs to the app"
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    assert any("--keys" in line for line in log)
    assert [e.type for e in read_events(rec.ld.events)] == ["start", "stop"]


def test_back_never_goes_below_slide_one(rig):
    def script(holder, log):
        holder["stream"].advance(1.0)
        yield "b"
        yield "b"
        yield "q"

    rec, holder, log = rig(script, keys=True)
    rec.run()
    slides = [e.slide for e in read_events(rec.ld.events) if e.type == "slide"]
    assert slides == [1, 1, 1]


# --------------------------------------------------------------------------- #
# takes: starting again in a folder that already holds a recording
# --------------------------------------------------------------------------- #


def test_existing_audio_is_never_overwritten(rig, tmp_path):
    """The point of takes: the first recording is never opened for writing."""
    ld = LectureDir(tmp_path / "lec")
    ld.root.mkdir(parents=True)
    ld.audio.write_bytes(b"precious")

    def script(holder, log):
        holder["stream"].advance(3.0)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()

    assert ld.audio.read_bytes() == b"precious", "take 1 is untouchable"
    assert rec.take == 2
    assert rec.audio_path == ld.root / "audio.take2.wav"
    assert sf.info(str(rec.audio_path)).frames == 3 * SR


def test_a_second_start_records_take_2_beside_take_1(rig, monkeypatch):
    """The recorder died mid-lecture and was started again in the same folder.

    The wall clock is frozen and moved by hand between the takes, so take 2's
    offset on the lecture clock - and therefore every `t` it writes - is exact.
    """
    clock = {"now": "2026-01-01T09:00:00.000+00:00"}
    monkeypatch.setattr("lecture_rec.record.now_iso", lambda: clock["now"])

    def first(holder, log):
        holder["stream"].advance(10.0)
        yield "q"

    rec1, _, log = rig(first)
    rec1.run()

    clock["now"] = "2026-01-01T09:20:00.000+00:00"      # 1200 s later

    def second(holder, log):
        holder["stream"].advance(5.0)
        yield "q"

    rec2, _, log = rig(second)
    rec2.run()

    ld = LectureDir(rec2.ld.root)
    assert rec1.take == 1 and rec2.take == 2
    assert rec2.take_offset_s == pytest.approx(1200.0)

    # Take 1 is exactly what it always was.
    assert sf.info(str(ld.audio)).frames == 10 * SR
    take1 = read_json(ld.recording)
    assert "take" not in take1
    assert take1["file"] == "audio.wav"
    assert take1["durationS"] == pytest.approx(10.0)

    # Take 2 sits beside it, under its own names, with its own startedWall.
    take2_audio = ld.audio_for_take(2)
    assert take2_audio.name == "audio.take2.wav"
    assert sf.info(str(take2_audio)).frames == 5 * SR
    take2 = read_json(ld.recording_for_take(2))
    assert ld.recording_for_take(2).name == "recording.take2.json"
    assert take2["take"] == 2
    assert take2["file"] == "audio.take2.wav"
    assert take2["startedWall"] == "2026-01-01T09:20:00.000+00:00"
    assert take2["durationS"] == pytest.approx(5.0)
    assert ld.take_numbers() == [1, 2] and ld.next_take() == 3

    # One clock: take 2's events carry the wall delta, not its own audio clock.
    events = read_events(ld.events)
    assert [(e.type, round(e.t, 3), e.take) for e in events] == [
        ("start", 0.0, None),
        ("stop", 10.0, None),
        ("start", 1200.0, 2),
        ("stop", 1205.0, 2),
    ]
    assert all(e.source == "recorder" for e in events)
    assert any("audio.take2.wav" in line and "take 2" in line for line in log), \
        "the recorder must say out loud that this is a second take"


def test_take_2_keys_mode_marks_slides_on_the_lecture_clock(rig, monkeypatch):
    clock = {"now": "2026-01-01T09:00:00.000+00:00"}
    monkeypatch.setattr("lecture_rec.record.now_iso", lambda: clock["now"])

    def first(holder, log):
        holder["stream"].advance(30.0)
        yield "q"

    rec1, _, _ = rig(first, keys=True)
    rec1.run()

    clock["now"] = "2026-01-01T09:01:00.000+00:00"      # 60 s later
    def second(holder, log):
        holder["stream"].advance(4.0)
        yield "9"                                        # slide 9 at 60 + 4 s
        holder["stream"].advance(6.0)
        yield "q"

    rec2, _, _ = rig(second, keys=True)
    rec2.run()

    events = [e for e in read_events(rec2.ld.events) if e.take == 2]
    assert [(e.type, round(e.t, 3), e.slide) for e in events] == [
        ("start", 60.0, None),
        ("slide", 60.0, 1),
        ("slide", 64.0, 9),
        ("stop", 70.0, None),
    ]


def test_take_2_heartbeat_reports_its_own_audio_clock_and_take_number(rig):
    """`elapsedS` is what the app shows as recording time: this take's audio."""
    def first(holder, log):
        holder["stream"].advance(8.0)
        yield "q"

    rec1, _, _ = rig(first)
    rec1.run()

    seen: dict = {}

    def second(holder, log):
        rec = seen["rec"]
        holder["stream"].advance(3.0, amplitude=0.2)
        assert wait_until(lambda: read_json(rec.ld.heartbeat)["elapsedS"] >= 3.0)
        seen["hb"] = read_json(rec.ld.heartbeat)
        yield "q"

    rec2, _, _ = rig(second, heartbeat_interval_s=0.02)
    seen["rec"] = rec2
    rec2.run()

    hb = seen["hb"]
    assert hb["take"] == 2
    assert hb["elapsedS"] == pytest.approx(3.0, abs=0.5), "this take's audio, not 11 s"
    assert hb["startedWall"] == read_json(rec2.ld.recording_for_take(2))["startedWall"]
    assert Heartbeat.from_dict(hb).take == 2
    assert not rec2.ld.heartbeat.exists()


def test_take_2_recording_json_validates_against_the_typescript_contract(rig):
    if shutil.which("node") is None:
        pytest.skip("node is not installed; cannot cross-check the TS contract")
    if not NODE_CLI.exists():
        pytest.skip(f"{NODE_CLI} is not built; run `npm run build` in lecture-companion")

    def script(holder, log):
        holder["stream"].advance(2.0)
        yield "q"

    rec1, _, _ = rig(script)
    rec1.run()
    rec2, _, _ = rig(script)
    rec2.run()

    for path in (rec2.ld.recording, rec2.ld.recording_for_take(2)):
        out = subprocess.run(
            ["node", str(NODE_CLI), "validate", str(path)],
            capture_output=True, text=True,
        )
        assert out.returncode == 0, out.stdout + out.stderr
        assert "ok" in out.stdout and "recording/1" in out.stdout


def test_take_2_without_a_take_1_recording_json_falls_back_to_the_start_event(
        rig, monkeypatch, tmp_path):
    """Audio but no metadata: the first `start` event is the same origin."""
    clock = {"now": "2026-01-01T09:00:00.000+00:00"}
    monkeypatch.setattr("lecture_rec.record.now_iso", lambda: clock["now"])

    def first(holder, log):
        holder["stream"].advance(5.0)
        yield "q"

    rec1, _, _ = rig(first)
    rec1.run()
    rec1.ld.recording.unlink()

    clock["now"] = "2026-01-01T09:00:30.000+00:00"
    def second(holder, log):
        holder["stream"].advance(2.0)
        yield "q"

    rec2, _, _ = rig(second)
    rec2.run()
    assert rec2.take_offset_s == pytest.approx(30.0)
    last = read_events(rec2.ld.events)[-1]
    assert last.type == "stop" and last.t == pytest.approx(32.0) and last.take == 2


def test_deck_is_copied_in(rig, tmp_path):
    deck = tmp_path / "slides.pdf"
    deck.write_bytes(b"%PDF-1.4 fake")

    def script(holder, log):
        holder["stream"].advance(1.0)
        yield "q"

    rec, holder, log = rig(script)
    rec.run(deck=str(deck))
    assert rec.ld.deck.read_bytes() == b"%PDF-1.4 fake"


def test_silence_threshold_is_sane():
    assert 0.0 < SILENCE_RMS < 0.01
