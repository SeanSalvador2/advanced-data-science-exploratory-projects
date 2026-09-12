#!/usr/bin/env python3
"""Build a synthetic lecture directory so the whole pipeline can be exercised
without a microphone, a real lecture, or ffmpeg.

    uv run python scripts/make_synthetic_lecture.py data/synthetic
    uv run python scripts/make_synthetic_lecture.py data/synthetic-app --app-events
    uv run python scripts/make_synthetic_lecture.py data/two --two-takes

Downloads the 11-second public-domain JFK clip that ships with whisper.cpp,
repeats it 8 times with 1.5 s of silence between repeats, and writes the
events / recording / bias files that `lecture-rec transcribe` expects. Also
writes reference_full.txt with the known transcript, so you can sanity-check
WER without hand-correcting anything.

Three shapes of lecture folder:

* default - what the Phase 0 recorder wrote: snake_case `recording.json`, and
  every event carrying an audio-clock `t`.
* `--app-events` - what the recorder and the browser app write together today:
  camelCase `recording.json` with `schema`, `start`/`stop` from the recorder
  with `t`, and slide events from the app with a wall clock only.
* `--two-takes` - the same, for a lecture whose recorder died: the first five
  repetitions are take 1 (`audio.wav`), then 20 s of nothing recorded, then the
  last three are take 2 (`audio.take2.wav` with `recording.take2.json`, whose
  `startedWall` is take 1's plus take 1's duration plus the gap). The app's
  slide events run across both, on the one lecture clock.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import soundfile as sf

JFK_URL = "https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/samples/jfk.wav"
JFK_TEXT = (
    "And so my fellow Americans, ask not what your country can do for you, "
    "ask what you can do for your country."
)

TARGET_SR = 16000
REPEATS = 8
GAP_S = 1.5
SLIDE_EVERY_S = 25.0
N_SLIDES = 4
TAKE1_REPEATS = 5       # --two-takes: repetitions before the recorder dies
TAKE_GAP_S = 20.0       # --two-takes: real time with nobody recording

PAGE_TERMS = {
    1: ["fellow Americans", "ask not", "inaugural"],
    2: ["country", "Americans", "fellow"],
    3: ["Americans", "country", "ask not"],
    4: ["fellow Americans", "country", "inaugural"],
}
GLOBAL_TERMS = ["Americans", "country", "fellow"]


def resample_linear(audio: np.ndarray, sr: int, target_sr: int) -> np.ndarray:
    if sr == target_sr:
        return audio.astype(np.float32)
    n_out = int(round(audio.size * target_sr / float(sr)))
    x_old = np.arange(audio.size, dtype=np.float64)
    x_new = np.linspace(0.0, audio.size - 1, n_out, dtype=np.float64)
    return np.interp(x_new, x_old, audio.astype(np.float64)).astype(np.float32)


def fetch_jfk(cache: Path) -> Path:
    """Download through whatever proxy the environment configures. TLS
    verification is left on: the default SSL context already trusts the proxy
    CA via SSL_CERT_FILE."""
    if cache.exists() and cache.stat().st_size > 1000:
        print(f"cached  {cache}")
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    print(f"fetching {JFK_URL}")
    req = urllib.request.Request(JFK_URL, headers={"User-Agent": "lecture-rec/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:      # noqa: S310
        data = resp.read()
    cache.write_bytes(data)
    print(f"saved   {cache}  ({len(data)} bytes)")
    return cache


def repeat_clip(clip: np.ndarray, repeats: int) -> np.ndarray:
    """`repeats` copies of the clip with GAP_S of silence between them."""
    gap = np.zeros(int(GAP_S * TARGET_SR), dtype=np.float32)
    parts: list[np.ndarray] = []
    for i in range(repeats):
        if i:
            parts.append(gap)
        parts.append(clip)
    return np.concatenate(parts)


def build(out: Path, app_events: bool = False, two_takes: bool = False) -> None:
    out.mkdir(parents=True, exist_ok=True)
    src = fetch_jfk(out.parent / ".cache" / "jfk.wav")

    if two_takes:
        app_events = True                     # takes only exist in the app shape

    clip, sr = sf.read(str(src), dtype="float32", always_2d=False)
    if clip.ndim > 1:
        clip = clip.mean(axis=1)
    clip = resample_linear(clip, sr, TARGET_SR)
    print(f"clip    {clip.size / TARGET_SR:.2f}s @ {TARGET_SR} Hz (source {sr} Hz)")

    if two_takes:
        # The recorder died after TAKE1_REPEATS repetitions and was started
        # again in the same folder TAKE_GAP_S later; nothing was recorded in
        # between, and take 2 is a second file beside the first.
        take1 = repeat_clip(clip, TAKE1_REPEATS)
        take2 = repeat_clip(clip, REPEATS - TAKE1_REPEATS)
        take1_s = take1.size / TARGET_SR
        take2_s = take2.size / TARGET_SR
        take2_offset = take1_s + TAKE_GAP_S
        duration = take2_offset + take2_s
        sf.write(str(out / "audio.wav"), take1, TARGET_SR, subtype="PCM_16")
        sf.write(str(out / "audio.take2.wav"), take2, TARGET_SR, subtype="PCM_16")
        print(f"audio   {out / 'audio.wav'}  (take 1, {take1_s:.2f}s)")
        print(f"audio   {out / 'audio.take2.wav'}  (take 2, {take2_s:.2f}s, "
              f"starting {take2_offset:.2f}s into the lecture)")
        print(f"        lecture clock 0-{duration:.2f}s, with a {TAKE_GAP_S:.0f}s "
              "gap nobody recorded")
    else:
        audio = repeat_clip(clip, REPEATS)
        duration = audio.size / TARGET_SR
        sf.write(str(out / "audio.wav"), audio, TARGET_SR, subtype="PCM_16")
        print(f"audio   {out / 'audio.wav'}  ({duration:.2f}s)")

    started = datetime.now().astimezone()

    def wall_at(offset_s: float) -> str:
        """The wall clock the app would have stamped `offset_s` into the lecture."""
        return (started + timedelta(seconds=offset_s)).isoformat(timespec="milliseconds")

    def parse_wall(text: str) -> datetime:
        return datetime.fromisoformat(text)

    slide_times = [min(k * SLIDE_EVERY_S, max(0.0, duration - 1.0))
                   for k in range(N_SLIDES)]

    if two_takes:
        # Every recorder event is on the LECTURE clock - take 2's `t` already
        # carries its offset - and take 2's events say which take they are from.
        events = [
            {"t": 0.0, "wall": wall_at(0.0), "type": "start", "source": "recorder"},
            {"t": round(take1_s, 3), "wall": wall_at(take1_s), "type": "stop",
             "source": "recorder"},
            {"t": round(take2_offset, 3), "wall": wall_at(take2_offset),
             "type": "start", "source": "recorder", "take": 2},
            {"t": round(duration, 3), "wall": wall_at(duration), "type": "stop",
             "source": "recorder", "take": 2},
        ]
        for k, t in enumerate(slide_times):
            events.append({"wall": wall_at(t), "type": "slide", "slide": k + 1,
                           "source": "app"})
        events.sort(key=lambda e: parse_wall(e["wall"]))
    elif app_events:
        # The recorder writes start and stop with both clocks; the app writes
        # slide events with a wall clock only, and says so with `source`.
        events = [{"t": 0.0, "wall": wall_at(0.0), "type": "start",
                   "source": "recorder"}]
        for k, t in enumerate(slide_times):
            events.append({"wall": wall_at(t), "type": "slide", "slide": k + 1,
                           "source": "app"})
        events.append({"t": round(duration, 3), "wall": wall_at(duration),
                       "type": "stop", "source": "recorder"})
    else:
        wall = started.isoformat(timespec="seconds")
        events = [{"t": 0.0, "wall": wall, "type": "start"}]
        for k, t in enumerate(slide_times):
            events.append({"t": round(t, 3), "wall": wall, "type": "slide",
                           "slide": k + 1})
        events.append({"t": round(duration, 3), "wall": wall, "type": "stop"})

    with (out / "events.jsonl").open("w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps(ev) + "\n")
    print(f"events  {out / 'events.jsonl'}  ({N_SLIDES} slides, "
          f"{'app-style, wall clock only' if app_events else 'recorder-style, with t'}"
          f"{', 2 takes' if two_takes else ''})")

    if two_takes:
        recording = {
            "schema": "recording/1",
            "startedWall": wall_at(0.0),
            "stoppedWall": wall_at(take1_s),
            "durationS": round(take1_s, 3),
            "sampleRate": TARGET_SR,
            "channels": 1,
            "device": "synthetic",
            "file": "audio.wav",
        }
        take2_recording = {
            "schema": "recording/1",
            # take 1's startedWall + take 1's duration + the gap: exactly what a
            # recorder restarted TAKE_GAP_S after the crash would have stamped.
            "startedWall": wall_at(take2_offset),
            "stoppedWall": wall_at(duration),
            "durationS": round(take2_s, 3),
            "sampleRate": TARGET_SR,
            "channels": 1,
            "device": "synthetic",
            "file": "audio.take2.wav",
            "take": 2,
        }
        (out / "recording.take2.json").write_text(
            json.dumps(take2_recording, indent=2) + "\n", encoding="utf-8")
        print(f"rec     {out / 'recording.take2.json'}  (take 2, startedWall "
              f"+{take2_offset:.2f}s)")
    elif app_events:
        recording = {
            "schema": "recording/1",
            "startedWall": wall_at(0.0),
            "stoppedWall": wall_at(duration),
            "durationS": round(duration, 3),
            "sampleRate": TARGET_SR,
            "channels": 1,
            "device": "synthetic",
            "file": "audio.wav",
        }
    else:
        recording = {
            "started_wall": started.isoformat(timespec="seconds"),
            "samplerate": TARGET_SR,
            "channels": 1,
            "file": "audio.wav",
            "device": "synthetic",
            "duration_s": round(duration, 3),
        }
    (out / "recording.json").write_text(
        json.dumps(recording, indent=2) + "\n", encoding="utf-8",
    )
    print(f"rec     {out / 'recording.json'}  "
          f"({'camelCase + schema' if app_events else 'snake_case, Phase 0'})")

    (out / "bias.json").write_text(
        json.dumps(
            {
                "schema": "bias/1",
                "deck": "deck.pdf",
                "source": "heuristic",
                "pages": [{"page": p, "terms": t} for p, t in sorted(PAGE_TERMS.items())],
                "global": GLOBAL_TERMS,
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"bias    {out / 'bias.json'}")

    (out / "reference_full.txt").write_text(
        "\n".join([JFK_TEXT] * REPEATS) + "\n", encoding="utf-8"
    )
    print(f"ref     {out / 'reference_full.txt'}")
    print()
    print("next:")
    print(f"  uv run lecture-rec transcribe {out} --engine faster-whisper --model tiny.en")
    print("or, for the quality measurement:")
    print(f"  uv run lecture-rec transcribe {out} --eval --engine faster-whisper "
          "--model tiny.en")
    print(f"  uv run lecture-rec sample {out} --n 2 --window-s 30")
    print(f"  uv run python scripts/make_synthetic_lecture.py {out} --seed-references")
    print(f"  uv run lecture-rec score {out}")


def seed_references(out: Path) -> int:
    """Overwrite every eval/window-*/reference.txt with the KNOWN transcript.

    Because the synthetic audio is one sentence on a fixed grid, the true text
    of any time window can be computed exactly. Run this after `lecture-rec
    sample` and before `lecture-rec score` to get a real WER instead of scoring the
    transcript against a copy of itself.
    """
    meta_path = out / "recording.json"
    if not meta_path.exists():
        raise SystemExit(f"no {meta_path}; build the lecture first")
    meta = json.loads(meta_path.read_text())
    duration = float(meta.get("durationS", meta.get("duration_s")))
    clip_s = (duration - (REPEATS - 1) * GAP_S) / REPEATS
    period = clip_s + GAP_S

    n = 0
    for wdir in sorted((out / "eval").glob("window-*")):
        wmeta = wdir / "meta.json"
        if not wmeta.exists():
            continue
        m = json.loads(wmeta.read_text())
        start, end = float(m["start"]), float(m["end"])
        reps = [
            i for i in range(REPEATS)
            if (i * period) < end and (i * period + clip_s) > start
        ]
        (wdir / "reference.txt").write_text(
            "\n".join([JFK_TEXT] * len(reps)) + "\n", encoding="utf-8"
        )
        print(f"{wdir / 'reference.txt'}: {len(reps)} known repetition(s)")
        n += 1
    if not n:
        raise SystemExit("no eval windows; run `lecture-rec sample` first")
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", help="output lecture directory, e.g. data/synthetic")
    ap.add_argument("--app-events", action="store_true",
                    help="write the app-style folder: camelCase recording.json, "
                         "slide events with a wall clock only")
    ap.add_argument("--two-takes", action="store_true",
                    help="a lecture whose recorder died: take 1 (audio.wav), a "
                         f"{TAKE_GAP_S:.0f}s gap, take 2 (audio.take2.wav with its "
                         "own recording.take2.json). Implies --app-events")
    ap.add_argument("--seed-references", action="store_true",
                    help="fill eval/window-*/reference.txt with the known transcript "
                         "(run after `lecture-rec sample`, instead of hand-correcting)")
    args = ap.parse_args()
    if args.seed_references:
        seed_references(Path(args.out))
        return 0
    build(Path(args.out), app_events=args.app_events, two_takes=args.two_takes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
