"""`spike doctor` - answer "will lecture day work?" before lecture day."""

from __future__ import annotations

import importlib.util
import platform
import shutil
import sys

from .record import RED, SILENCE_HELP, SILENCE_RMS, _color

MIC_TEST_S = 3.0


def _ok(flag: bool) -> str:
    return "yes" if flag else "NO"


def _importable(mod: str) -> tuple[bool, str]:
    try:
        spec = importlib.util.find_spec(mod)
    except (ImportError, ValueError):
        return False, ""
    if spec is None:
        return False, ""
    try:
        m = importlib.import_module(mod)
        return True, str(getattr(m, "__version__", "") or "")
    except Exception as exc:
        return False, f"present but fails to import: {exc}"


def run_doctor(mic_seconds: float = MIC_TEST_S) -> int:
    problems = 0

    print("== platform ==")
    print(f"  python      {sys.version.split()[0]}  ({sys.executable})")
    print(f"  platform    {platform.system()} {platform.release()} / {platform.machine()}")
    apple = platform.system() == "Darwin" and platform.machine() == "arm64"
    print(f"  apple silicon: {_ok(apple)}")
    print()

    print("== engines ==")
    for mod, label in (
        ("mlx_whisper", "mlx-whisper (fast on Apple Silicon)"),
        ("faster_whisper", "faster-whisper (CPU, works everywhere)"),
        ("parakeet_mlx", "parakeet-mlx (Apple Silicon, no biasing)"),
    ):
        found, extra = _importable(mod)
        print(f"  {label:<40} {_ok(found)}{('  ' + extra) if extra else ''}")
    if not _importable("faster_whisper")[0] and not _importable("mlx_whisper")[0]:
        print(_color("  no usable ASR engine installed - run `uv sync`", RED))
        problems += 1
    if apple and not _importable("mlx_whisper")[0]:
        print("  hint: `uv sync --extra mlx` for the fast path; faster-whisper "
              "works but is several times slower.")
    print()

    ff = shutil.which("ffmpeg")
    print("== ffmpeg ==")
    print(f"  on PATH: {_ok(bool(ff))}{('  ' + ff) if ff else ''}")
    if not ff:
        print("  spike itself does not need ffmpeg (WAV in, WAV out), but "
              "`brew install ffmpeg` is worth having for anything else.")
    print()

    print("== audio input ==")
    try:
        import sounddevice as sd
    except Exception as exc:
        print(_color(f"  sounddevice unavailable: {exc}", RED))
        print("  On Linux you need libportaudio2; on macOS the wheel is self-contained.")
        return 1

    try:
        devices = sd.query_devices()
        default_in = sd.default.device[0]
        inputs = [(i, d) for i, d in enumerate(devices)
                  if d.get("max_input_channels", 0) > 0]
        if not inputs:
            print(_color("  NO input devices at all.", RED))
            problems += 1
        for i, d in inputs:
            mark = "*" if i == default_in else " "
            print(f"  {mark} [{i}] {d['name']}  "
                  f"({d['max_input_channels']} ch, default {d['default_samplerate']:.0f} Hz)")
        print("  (* = default input)")

        if inputs:
            print("  supported rates on the default input:", end=" ")
            good = []
            for rate in (16000, 22050, 44100, 48000):
                try:
                    sd.check_input_settings(device=default_in, samplerate=rate,
                                            channels=1, dtype="float32")
                    good.append(str(rate))
                except Exception:
                    pass
            print(", ".join(good) if good else "none reported")
            if "16000" not in good:
                print("  note: 16 kHz not advertised; sounddevice will resample for us.")
    except Exception as exc:
        print(_color(f"  could not query devices: {exc}", RED))
        problems += 1
        return 1 if problems else 0
    print()

    print(f"== {mic_seconds:.0f}-second microphone level test ==")
    print("  Say something now...")
    try:
        import numpy as np

        rec = sd.rec(int(mic_seconds * 16000), samplerate=16000, channels=1,
                     dtype="float32")
        sd.wait()
        audio = np.asarray(rec, dtype=np.float32).reshape(-1)
        a = audio.astype(np.float64)
        rms = float(np.sqrt((a * a).mean())) if a.size else 0.0
        peak = float(np.abs(a).max()) if a.size else 0.0
        print(f"  rms {rms:.5f}   peak {peak:.5f}")
        bars = int(min(40, rms * 40 / 0.05))
        print(f"  [{'#' * bars}{'.' * (40 - bars)}]")
        if rms < SILENCE_RMS:
            print(_color("!" * 72, RED))
            print(_color(SILENCE_HELP, RED))
            print(_color("!" * 72, RED))
            problems += 1
        elif rms < 0.01:
            print("  quiet but not silent. Fine for a close mic; if this is the "
                  "lecture setup, move closer or raise the input volume.")
        else:
            print("  microphone looks good.")
    except Exception as exc:
        print(_color(f"  mic test failed: {exc}", RED))
        print(_color(SILENCE_HELP, RED))
        problems += 1
    print()

    print("== summary ==")
    if problems:
        print(_color(f"  {problems} problem(s) above. Fix them BEFORE the lecture.", RED))
    else:
        print("  ready to record.")
    return 1 if problems else 0
