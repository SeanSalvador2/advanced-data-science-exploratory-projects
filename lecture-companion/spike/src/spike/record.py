"""The lecture-day recorder.

Design constraints, all of which the tests check:

* Event times come from the AUDIO clock (frames captured / samplerate), never
  from wall clock, so a slide marker can never drift away from the audio.
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
    Event,
    LectureDir,
    RecordingMeta,
    append_event,
    fmt_mmss,
    now_iso,
    write_json,
)

SAMPLERATE = 16000
CHANNELS = 1
BLOCKSIZE = 1600                # 100 ms
FLUSH_INTERVAL_S = 5.0          # <= 5 s, per the brief
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
    "  `spike record` from there. Terminals embedded in editors (VS Code, Cursor,\n"
    "  JetBrains) very often record digital silence with no error at all.\n"
    "  Check System Settings > Privacy & Security > Microphone.\n"
    "  Also check: right input device (`spike doctor`), input volume not at zero,\n"
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
        self.out = out

        self._q: "queue.Queue[Optional[np.ndarray]]" = queue.Queue()
        self._frames_captured = 0
        self._lock = threading.Lock()
        self._writer: Optional[threading.Thread] = None
        self._file = None
        self._stream = None
        self._caffeinate: Optional[subprocess.Popen] = None
        self._stopped = False

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

    # -- lifecycle ---------------------------------------------------------- #

    def start(self, deck: Optional[str] = None) -> None:
        import soundfile as sf

        self.ld.root.mkdir(parents=True, exist_ok=True)
        (self.ld.root / "transcripts").mkdir(exist_ok=True)

        if deck:
            src = Path(deck)
            if not src.exists():
                raise SystemExit(f"deck not found: {src}")
            self.ld.deck.write_bytes(src.read_bytes())
            self.out(f"deck -> {self.ld.deck}")

        if self.ld.audio.exists():
            raise SystemExit(
                f"{self.ld.audio} already exists. Use a fresh --dir so an existing "
                "recording can never be overwritten."
            )

        self._file = sf.SoundFile(
            str(self.ld.audio), mode="w", samplerate=self.samplerate,
            channels=self.channels, subtype="PCM_16",
        )
        self._writer = threading.Thread(target=self._write_loop, daemon=True)
        self._writer.start()

        meta = RecordingMeta(
            started_wall=now_iso(), samplerate=self.samplerate,
            channels=self.channels, file="audio.wav",
            device=str(self.device) if self.device else "default",
            duration_s=None,
        )
        write_json(self.ld.recording, meta.to_dict())
        self._meta = meta

        self._start_caffeinate()

        self._stream = self.stream_factory(
            self.feed, self.samplerate, self.channels, self.device
        )
        if hasattr(self._stream, "start"):
            self._stream.start()

        append_event(self.ld.events, Event(t=0.0, wall=now_iso(), type="start"))
        append_event(self.ld.events,
                     Event(t=0.0, wall=now_iso(), type="slide", slide=self.current_slide))
        self.out(f"recording -> {self.ld.audio}  (slide {self.current_slide})")
        self.out(self.help_text())

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
        self._q.put(None)
        if self._writer is not None:
            self._writer.join(timeout=30)
        if self._file is not None:
            self._file.close()
        append_event(self.ld.events, Event(t=t, wall=now_iso(), type="stop"))
        self._meta.duration_s = t
        write_json(self.ld.recording, self._meta.to_dict())
        if self._caffeinate is not None:
            try:
                self._caffeinate.terminate()
            except Exception:                           # pragma: no cover
                pass
        self.out(f"stopped after {fmt_mmss(t)}  ->  {self.ld.audio}")

    # -- command protocol --------------------------------------------------- #

    def handle_line(self, raw: str) -> bool:
        """Apply one command line. Returns False when the recording should stop."""
        line = raw.strip()
        t = self.elapsed_s

        if line == "":
            self.current_slide += 1
            append_event(self.ld.events,
                         Event(t=t, wall=now_iso(), type="slide", slide=self.current_slide))
        elif line.lower() == "q":
            return False
        elif line.lower() == "b":
            self.current_slide = max(1, self.current_slide - 1)
            append_event(self.ld.events,
                         Event(t=t, wall=now_iso(), type="slide", slide=self.current_slide))
        elif line.lower().startswith("n ") or line.lower() == "n":
            text = line[2:].strip() if len(line) > 1 else ""
            append_event(self.ld.events,
                         Event(t=t, wall=now_iso(), type="note", text=text))
            self.out(f"  note @ {fmt_mmss(t)}: {text}")
        elif line.lstrip("+").isdigit():
            self.current_slide = max(1, int(line.lstrip("+")))
            append_event(self.ld.events,
                         Event(t=t, wall=now_iso(), type="slide", slide=self.current_slide))
        else:
            self.out(f"  ? unknown command {line!r}")
            self.out(self.help_text())
            return True

        self.out(f"  slide {self.current_slide}   {fmt_mmss(self.elapsed_s)}")
        return True

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
) -> None:
    Recorder(dir_path, device=device).run(deck=deck)
