"""The lecture-day recorder.

It runs beside the browser app: the app appends `slide` and `note` events to
the same `events.jsonl` with wall-clock times only, and reads
`.lecture/heartbeat.json` to show that recording is really happening. The
recorder itself writes only `start` and `stop`, unless `--keys` is given, in
which case the Phase 0 keyboard protocol is back and it writes slide and note
events too.

Design constraints, all of which the tests check:

* Event times come from the AUDIO clock (frames captured / samplerate), never
  from wall clock, so a slide marker can never drift away from the audio.
* Nothing recorded is ever opened for writing again. Started in a folder that
  already holds `audio.wav`, the recorder records the NEXT TAKE beside it -
  `audio.take2.wav` with `recording.take2.json` - which is what makes it safe
  to restart after a crash twenty minutes into a lecture. Take N's events are
  written on the LECTURE clock (take 1's `startedWall` is its zero), so the
  recorder's `t` and the app's wall-clock events agree, and `transcribe`
  stitches the takes onto that one clock.
* Every event line is one `O_APPEND` write of under 4 KB, so the app appending
  to the same file cannot interleave half a line with ours.
* `.lecture/heartbeat.json` is rewritten every 2 s through a temp file and
  `os.replace`, so the app never reads a half-written heartbeat, and is deleted
  on a clean stop, so a crashed recorder shows up as a stale file.
* The WAV is flushed at least every 5 s, so a crash or a dead battery leaves a
  playable file with everything up to the last few seconds.
* On macOS a `caffeinate -dims -w <pid>` child keeps the Mac awake for exactly
  as long as this process lives.
* A silent microphone is shouted about, not silently tolerated - but never
  aborts the recording, because "silent" might just mean "the lecturer has not
  started talking yet".
* The input stream and the command source are injectable, so the whole thing
  can be tested without a microphone.
"""

from __future__ import annotations

import collections
import math
import os
import platform
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Callable, Iterable, Iterator, Optional

import numpy as np

from .schemas import (
    HEARTBEAT_INTERVAL_S,
    Event,
    Heartbeat,
    LectureDir,
    RecordingMeta,
    append_event,
    fmt_mmss,
    iso_delta_s,
    now_iso,
    read_events,
    write_json,
)

SAMPLERATE = 16000
CHANNELS = 1
BLOCKSIZE = 1600                # 100 ms
FLUSH_INTERVAL_S = 5.0          # <= 5 s, per the brief
RMS_WINDOW_S = 2.0              # the heartbeat reports the RMS of this much audio
FIRST_SILENCE_CHECK_S = 5.0
SILENCE_REPEAT_S = 30.0
SILENCE_RMS = 0.0015            # roughly -56 dBFS; real room noise is well above

RED = "\033[1;31m"
YELLOW = "\033[1;33m"
RESET = "\033[0m"

SILENCE_HELP = (
    "SILENT INPUT: the microphone is delivering (near) zeros.\n"
    "  Most likely cause on macOS: microphone permission belongs to the TERMINAL\n"
    "  APP, not to python. Quit, open Terminal.app or iTerm directly, and run\n"
    "  `lecture-rec record` from there. Terminals embedded in editors (VS Code, Cursor,\n"
    "  JetBrains) very often record digital silence with no error at all.\n"
    "  Check System Settings > Privacy & Security > Microphone.\n"
    "  Also check: right input device (`lecture-rec doctor`), input volume not at zero,\n"
    "  nothing else holding the mic (Zoom, Teams, Photo Booth).\n"
    "  Recording continues - if the lecture simply has not started, ignore this."
)


def _color(text: str, code: str, stream=None) -> str:
    stream = stream or sys.stdout
    if os.environ.get("NO_COLOR") or not hasattr(stream, "isatty") or not stream.isatty():
        return text
    return f"{code}{text}{RESET}"


# --------------------------------------------------------------------------- #
# stream injection
# --------------------------------------------------------------------------- #


def sounddevice_stream_factory(
    callback: Callable[[np.ndarray], None],
    samplerate: int,
    channels: int,
    device: Optional[str],
):
    """Default factory: a real sounddevice.InputStream wired to `callback`."""
    import sounddevice as sd

    def _cb(indata, frames, time_info, status):     # noqa: ANN001
        if status:
            print(_color(f"  [audio status] {status}", YELLOW), file=sys.stderr)
        callback(np.array(indata, copy=True))

    return sd.InputStream(
        samplerate=samplerate,
        channels=channels,
        dtype="float32",
        blocksize=BLOCKSIZE,
        device=device,
        callback=_cb,
    )


def stdin_lines() -> Iterator[str]:
    for line in sys.stdin:
        yield line.rstrip("\n")


# --------------------------------------------------------------------------- #
# recorder
# --------------------------------------------------------------------------- #


class Recorder:
    def __init__(
        self,
        dir_path: str | Path,
        samplerate: int = SAMPLERATE,
        channels: int = CHANNELS,
        device: Optional[str] = None,
        stream_factory: Callable = sounddevice_stream_factory,
        line_source: Optional[Iterable[str]] = None,
        flush_interval_s: float = FLUSH_INTERVAL_S,
        silence_rms: float = SILENCE_RMS,
        use_caffeinate: bool = True,
        keys: bool = False,
        heartbeat_interval_s: float = HEARTBEAT_INTERVAL_S,
        out: Callable[[str], None] = print,
    ):
        self.ld = LectureDir(dir_path)
        self.samplerate = int(samplerate)
        self.channels = int(channels)
        self.device = device
        self.stream_factory = stream_factory
        self.line_source = line_source
        self.flush_interval_s = float(flush_interval_s)
        self.silence_rms = float(silence_rms)
        self.use_caffeinate = use_caffeinate
        self.keys = bool(keys)
        self.heartbeat_interval_s = float(heartbeat_interval_s)
        self.out = out

        self._q: "queue.Queue[Optional[np.ndarray]]" = queue.Queue()
        self._frames_captured = 0
        self._lock = threading.Lock()
        self._writer: Optional[threading.Thread] = None
        self._file = None
        self._stream = None
        self._caffeinate: Optional[subprocess.Popen] = None
        self._stopped = False
        self._heartbeat_thread: Optional[threading.Thread] = None
        self._heartbeat_stop = threading.Event()
        self._recent: "collections.deque[np.ndarray]" = collections.deque()
        self._recent_n = 0
        self._started_wall: Optional[str] = None
        #: Which take this run records, and where it lands. Decided in `start()`,
        #: because the folder can gain an `audio.wav` between construction and
        #: the moment recording begins.
        self.take = 1
        self.audio_path = self.ld.audio
        self.recording_path = self.ld.recording
        #: Seconds from take 1's first audio frame to this take's first frame.
        #: Zero on take 1; every event `t` this recorder writes is this plus the
        #: audio clock, so every take's events share one lecture clock.
        self.take_offset_s = 0.0

        self.current_slide = 1
        # silence detection state
        self._win_sumsq = 0.0
        self._win_n = 0
        self._next_check_s = FIRST_SILENCE_CHECK_S
        self._audio_detected = False

    # -- audio clock -------------------------------------------------------- #

    @property
    def elapsed_s(self) -> float:
        """Seconds of audio captured so far. This is the only clock we trust."""
        with self._lock:
            return self._frames_captured / float(self.samplerate)

    def lecture_t(self, audio_t: Optional[float] = None) -> float:
        """This take's audio clock, moved onto the lecture clock.

        Identical to `elapsed_s` on take 1, where the two clocks are the same
        thing; on take N it is `startedWall_N - startedWall_1` later.
        """
        t = self.elapsed_s if audio_t is None else float(audio_t)
        return self.take_offset_s + t

    # -- capture ------------------------------------------------------------ #

    def feed(self, block: np.ndarray) -> None:
        """Called from the audio callback (or, in tests, directly)."""
        block = np.asarray(block, dtype=np.float32)
        n = block.shape[0]
        mono = block.mean(axis=1) if block.ndim > 1 else block
        with self._lock:
            self._frames_captured += n
            self._win_sumsq += float(np.dot(mono.astype(np.float64), mono.astype(np.float64)))
            self._win_n += n
            self._recent.append(mono.astype(np.float32, copy=True))
            self._recent_n += n
            keep = int(RMS_WINDOW_S * self.samplerate)
            while self._recent and (self._recent_n - self._recent[0].size) >= keep:
                self._recent_n -= self._recent.popleft().size
        self._q.put(block)
        self._maybe_warn_silence()

    def _maybe_warn_silence(self) -> None:
        if self._audio_detected:
            return
        with self._lock:
            elapsed = self._frames_captured / float(self.samplerate)
            if elapsed < self._next_check_s or self._win_n == 0:
                return
            rms = math.sqrt(self._win_sumsq / self._win_n)
            self._win_sumsq = 0.0
            self._win_n = 0
            if rms >= self.silence_rms:
                self._audio_detected = True
                self._next_check_s = float("inf")
            else:
                self._next_check_s = elapsed + SILENCE_REPEAT_S
        if self._audio_detected:
            self.out(_color(f"  audio detected (rms {rms:.4f}) - recording is live.",
                            YELLOW))
        else:
            self.out(_color("!" * 72, RED))
            self.out(_color(SILENCE_HELP, RED))
            self.out(_color("!" * 72, RED))

    def _write_loop(self) -> None:
        import time as _time

        last_flush = _time.monotonic()
        while True:
            block = self._q.get()
            if block is None:
                break
            self._file.write(block)
            if _time.monotonic() - last_flush >= self.flush_interval_s:
                self._file.flush()
                last_flush = _time.monotonic()
        self._file.flush()

    # -- heartbeat ---------------------------------------------------------- #

    def rms_recent(self) -> float:
        """RMS of the last `RMS_WINDOW_S` seconds of captured audio."""
        with self._lock:
            blocks = list(self._recent)
        if not blocks:
            return 0.0
        total = 0.0
        n = 0
        for b in blocks:
            a = b.astype(np.float64)
            total += float(np.dot(a, a))
            n += a.size
        return math.sqrt(total / n) if n else 0.0

    def heartbeat(self) -> Heartbeat:
        # `elapsedS` stays THIS take's audio clock - it is what the app shows as
        # the recording time - and `take` says which take is being recorded.
        return Heartbeat(
            pid=os.getpid(),
            started_wall=self._started_wall or now_iso(),
            updated_wall=now_iso(),
            elapsed_s=self.elapsed_s,
            rms_recent=self.rms_recent(),
            take=self.take,
        )

    def write_heartbeat(self) -> None:
        """Atomic by construction: `write_json` writes a temp file in the same
        directory and `os.replace`s it into place, so the app reads either the
        previous heartbeat or this one, never a partial line."""
        write_json(self.ld.heartbeat, self.heartbeat().to_dict())

    def _heartbeat_loop(self) -> None:
        while not self._heartbeat_stop.wait(self.heartbeat_interval_s):
            try:
                self.write_heartbeat()
            except Exception as exc:                    # pragma: no cover
                self.out(_color(f"  heartbeat write failed: {exc}", YELLOW))

    def _remove_heartbeat(self) -> None:
        try:
            self.ld.heartbeat.unlink()
        except FileNotFoundError:
            pass
        except OSError as exc:                          # pragma: no cover
            self.out(_color(f"  could not remove {self.ld.heartbeat}: {exc}", YELLOW))

    # -- lifecycle ---------------------------------------------------------- #

    def start(self, deck: Optional[str] = None) -> None:
        import soundfile as sf

        self.ld.root.mkdir(parents=True, exist_ok=True)

        if deck:
            src = Path(deck)
            if not src.exists():
                raise SystemExit(f"deck not found: {src}")
            self.ld.deck.write_bytes(src.read_bytes())
            self.out(f"deck -> {self.ld.deck}")

        # Which take is this? Take 1 keeps the plain names; a folder that already
        # holds audio gets the next take beside it. Nothing already recorded is
        # ever opened for writing, so there is no flag that could overwrite a
        # lecture - restarting after a crash is simply take 2.
        self.take = self.ld.next_take()
        self.audio_path = self.ld.audio_for_take(self.take)
        self.recording_path = self.ld.recording_for_take(self.take)
        if self.take > 1:
            self.out(
                f"{self.ld.audio} exists; recording take {self.take} to "
                f"{self.audio_path.name}; the transcriber will stitch the takes"
            )

        self._file = sf.SoundFile(
            str(self.audio_path), mode="w", samplerate=self.samplerate,
            channels=self.channels, subtype="PCM_16",
        )
        self._writer = threading.Thread(target=self._write_loop, daemon=True)
        self._writer.start()

        self._start_caffeinate()

        self._stream = self.stream_factory(
            self.feed, self.samplerate, self.channels, self.device
        )
        if hasattr(self._stream, "start"):
            self._stream.start()
        # `startedWall` is the wall time of audio frame 0. We take it the moment
        # `stream.start()` returns: PortAudio has the device running by then, so
        # the residual offset between this timestamp and the first captured
        # frame is the device's start latency - a few milliseconds, well under
        # 100 ms, and far below the one-second granularity a slide marker needs.
        # The callback's `time_info.inputBufferAdcTime` could shave that off,
        # but it is on a different clock base per host API, so it is not worth
        # the correction.
        self._started_wall = now_iso()
        self.take_offset_s = self._compute_take_offset(self._started_wall)

        meta = RecordingMeta(
            started_wall=self._started_wall,
            sample_rate=self.samplerate,
            channels=self.channels,
            file=self.audio_path.name,
            device=str(self.device) if self.device else "default",
            duration_s=None,
            take=self.take if self.take > 1 else None,
        )
        write_json(self.recording_path, meta.to_dict())
        self._meta = meta

        self._append(Event(t=self.lecture_t(0.0), wall=self._started_wall,
                           type="start", source="recorder"))
        if self.keys:
            self._append(Event(t=self.lecture_t(0.0), wall=now_iso(), type="slide",
                               slide=self.current_slide, source="recorder"))

        self.ld.dot_lecture.mkdir(parents=True, exist_ok=True)
        self.write_heartbeat()
        self._heartbeat_stop.clear()
        self._heartbeat_thread = threading.Thread(target=self._heartbeat_loop,
                                                  daemon=True)
        self._heartbeat_thread.start()

        self.out(f"recording -> {self.audio_path}")
        if self.take > 1:
            self.out(f"  take {self.take}, {fmt_mmss(self.take_offset_s)} into the "
                     "lecture clock that take 1 started")
        self.out(self.mode_line())
        if self.keys:
            self.out(self.help_text())

    def _compute_take_offset(self, started_wall: str) -> float:
        """Seconds from take 1's first audio frame to this take's first frame.

        Take 1's `recording.json` holds the origin. If it is missing (a folder
        with audio but no metadata), the first `start` event's wall clock does
        the same job. With neither, the offset has to be zero and the takes
        would sit on top of each other, so say so loudly.
        """
        if self.take <= 1:
            return 0.0

        origin: Optional[str] = None
        first = self.ld.load_recording_for_take(1)
        if first is not None and first.started_wall:
            origin = first.started_wall
        else:
            for ev in read_events(self.ld.events):
                if ev.type == "start" and ev.wall:
                    origin = ev.wall
                    break

        if origin is None:
            self.out(_color(
                f"  no take 1 startedWall in {self.ld.recording} and no start event: "
                "take times cannot be offset; the takes will overlap on the "
                "lecture clock.", YELLOW))
            return 0.0

        try:
            offset = iso_delta_s(started_wall, origin)
        except ValueError:
            self.out(_color(f"  unreadable take 1 startedWall {origin!r}; "
                            "recording take times from zero.", YELLOW))
            return 0.0

        if offset < 0.0:
            self.out(_color(
                f"  take 1 started {abs(offset):.1f}s in the FUTURE (system clock "
                "changed?); recording take times from zero.", YELLOW))
            return 0.0
        return offset

    def _append(self, ev: Event) -> None:
        """Append one event, tagged with this take (absent on take 1)."""
        if self.take > 1:
            ev.take = self.take
        append_event(self.ld.events, ev)

    def _start_caffeinate(self) -> None:
        if not self.use_caffeinate or platform.system() != "Darwin":
            return
        try:
            self._caffeinate = subprocess.Popen(
                ["caffeinate", "-dims", "-w", str(os.getpid())],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            self.out("  caffeinate: the Mac will stay awake until this exits")
        except Exception as exc:                        # pragma: no cover
            self.out(_color(f"  caffeinate failed ({exc}); disable sleep by hand",
                            YELLOW))

    def mode_line(self) -> str:
        """One line telling the user which of the two modes they are in."""
        if self.keys:
            return (f"  mode: --keys - slide markers come from THIS terminal "
                    f"(starting on slide {self.current_slide}); the app is not needed")
        return ("  mode: app - slide and note events come from the browser app; "
                "here only q stops (Ctrl-C too)")

    @staticmethod
    def help_text() -> str:
        return (
            "  [Enter] next slide   b  previous slide   <number> jump to slide\n"
            "  n <text>  note       q  stop             Ctrl-C also stops cleanly"
        )

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        if self._stream is not None:
            for m in ("stop", "close"):
                try:
                    getattr(self._stream, m)()
                except Exception:                       # pragma: no cover
                    pass
        t = self.elapsed_s
        self._heartbeat_stop.set()
        if self._heartbeat_thread is not None:
            self._heartbeat_thread.join(timeout=5)
        self._q.put(None)
        if self._writer is not None:
            self._writer.join(timeout=30)
        if self._file is not None:
            self._file.close()
        stopped_wall = now_iso()
        self._append(Event(t=self.lecture_t(t), wall=stopped_wall, type="stop",
                           source="recorder"))
        self._meta.duration_s = t
        self._meta.stopped_wall = stopped_wall
        write_json(self.recording_path, self._meta.to_dict())
        # Clean stop: the heartbeat goes away, so the app shows "no recorder"
        # rather than a file that quietly stops being updated.
        self._remove_heartbeat()
        if self._caffeinate is not None:
            try:
                self._caffeinate.terminate()
            except Exception:                           # pragma: no cover
                pass
        self.out(f"stopped after {fmt_mmss(t)}  ->  {self.audio_path}")
        if self.take > 1:
            self.out(f"  that was take {self.take}; `lecture-rec transcribe "
                     f"{self.ld.root}` puts all {self.take} takes on one clock")

    # -- command protocol --------------------------------------------------- #

    def handle_line(self, raw: str) -> bool:
        """Apply one command line. Returns False when the recording should stop."""
        line = raw.strip()

        if line.lower() == "q":
            return False
        if not self.keys:
            # App mode: the app owns slide and note events. Enter does nothing
            # here on purpose - pressing it out of Phase 0 habit must not write
            # a slide event the app knows nothing about.
            if line:
                self.out("  (app mode: only q stops. Use --keys to mark slides here.)")
            return True

        t = self.elapsed_s

        if line == "":
            self.current_slide += 1
            self._slide_event(t)
        elif line.lower() == "b":
            self.current_slide = max(1, self.current_slide - 1)
            self._slide_event(t)
        elif line.lower().startswith("n ") or line.lower() == "n":
            text = line[2:].strip() if len(line) > 1 else ""
            self._append(Event(t=self.lecture_t(t), wall=now_iso(), type="note",
                               text=text, source="recorder"))
            self.out(f"  note @ {fmt_mmss(t)}: {text}")
        elif line.lstrip("+").isdigit():
            self.current_slide = max(1, int(line.lstrip("+")))
            self._slide_event(t)
        else:
            self.out(f"  ? unknown command {line!r}")
            self.out(self.help_text())
            return True

        self.out(f"  slide {self.current_slide}   {fmt_mmss(self.elapsed_s)}")
        return True

    def _slide_event(self, t: float) -> None:
        self._append(Event(t=self.lecture_t(t), wall=now_iso(), type="slide",
                           slide=self.current_slide, source="recorder"))

    def run(self, deck: Optional[str] = None) -> None:
        self.start(deck=deck)
        source = self.line_source if self.line_source is not None else stdin_lines()
        try:
            for line in source:
                if not self.handle_line(line):
                    break
        except KeyboardInterrupt:
            self.out("")
            self.out("  Ctrl-C - stopping cleanly")
        finally:
            self.stop()


def run_record(
    dir_path: str | Path,
    deck: Optional[str] = None,
    device: Optional[str] = None,
    keys: bool = False,
) -> None:
    Recorder(dir_path, device=device, keys=keys).run(deck=deck)
