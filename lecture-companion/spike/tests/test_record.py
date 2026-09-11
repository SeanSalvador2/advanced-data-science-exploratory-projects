"""Recorder behaviour, driven by a fake input stream and a scripted stdin.

There is no microphone in CI, so the stream is injected. The fake stream pushes
frames synchronously from the same thread that feeds commands, which makes the
audio clock - and therefore every event timestamp - exactly predictable.
"""

from __future__ import annotations

import platform

import numpy as np
import pytest
import soundfile as sf

from spike.record import FLUSH_INTERVAL_S, SILENCE_RMS, Recorder
from spike.schemas import LectureDir, read_events, read_json

SR = 16000


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


def test_scripted_recording_produces_correct_events_and_wav(rig):
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

    rec, holder, log = rig(script)
    rec.run()

    ld = LectureDir(rec.ld.root)
    events = read_events(ld.events)
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

    info = sf.info(str(ld.audio))
    assert info.samplerate == SR
    assert info.channels == 1
    assert info.frames == 48 * SR
    assert info.duration == pytest.approx(48.0)
    assert info.subtype == "PCM_16"

    meta = read_json(ld.recording)
    assert meta["duration_s"] == pytest.approx(48.0)
    assert meta["samplerate"] == SR and meta["channels"] == 1
    assert meta["file"] == "audio.wav"

    assert holder["stream"].started and holder["stream"].stopped


def test_event_times_come_from_the_audio_clock_not_wall_clock(rig, monkeypatch):
    """Freeze wall time entirely: event `t` must still advance with the audio."""
    monkeypatch.setattr("spike.record.now_iso", lambda: "2026-01-01T09:00:00+00:00")

    def script(holder, log):
        holder["stream"].advance(7.5)
        yield ""
        holder["stream"].advance(12.25)
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    events = read_events(rec.ld.events)
    assert {e.wall for e in events} == {"2026-01-01T09:00:00+00:00"}
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
    assert read_json(rec.ld.recording)["duration_s"] == pytest.approx(10.0)
    assert sf.info(str(rec.ld.audio)).duration == pytest.approx(10.0)
    assert holder["stream"].closed


def test_silence_triggers_a_loud_warning_that_repeats(rig):
    def script(holder, log):
        holder["stream"].advance(6.0, amplitude=0.0)     # first check at 5 s
        yield "n still silent"
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

    rec, holder, log = rig(script)
    rec.run()
    assert any("unknown command" in line for line in log)
    slides = [e for e in read_events(rec.ld.events) if e.type == "slide"]
    assert [e.slide for e in slides] == [1]


def test_back_never_goes_below_slide_one(rig):
    def script(holder, log):
        holder["stream"].advance(1.0)
        yield "b"
        yield "b"
        yield "q"

    rec, holder, log = rig(script)
    rec.run()
    slides = [e.slide for e in read_events(rec.ld.events) if e.type == "slide"]
    assert slides == [1, 1, 1]


def test_existing_audio_is_never_overwritten(tmp_path):
    ld = LectureDir(tmp_path / "lec")
    ld.root.mkdir(parents=True)
    ld.audio.write_bytes(b"precious")
    rec = Recorder(ld.root, stream_factory=lambda *a: None, line_source=iter([]))
    with pytest.raises(SystemExit):
        rec.start()
    assert ld.audio.read_bytes() == b"precious"


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
