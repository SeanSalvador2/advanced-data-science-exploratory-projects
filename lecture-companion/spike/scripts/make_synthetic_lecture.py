#!/usr/bin/env python3
"""Build a synthetic lecture directory so the whole pipeline can be exercised
without a microphone, a real lecture, or ffmpeg.

    uv run python scripts/make_synthetic_lecture.py data/synthetic

Downloads the 11-second public-domain JFK clip that ships with whisper.cpp,
repeats it 8 times with 1.5 s of silence between repeats, and writes the
events / recording / bias files that `spike transcribe` expects. Also writes
reference_full.txt with the known transcript, so you can sanity-check WER
without hand-correcting anything.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from datetime import datetime
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
    req = urllib.request.Request(JFK_URL, headers={"User-Agent": "spike/0.1"})
    with urllib.request.urlopen(req, timeout=120) as resp:      # noqa: S310
        data = resp.read()
    cache.write_bytes(data)
    print(f"saved   {cache}  ({len(data)} bytes)")
    return cache


def build(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    src = fetch_jfk(out.parent / ".cache" / "jfk.wav")

    clip, sr = sf.read(str(src), dtype="float32", always_2d=False)
    if clip.ndim > 1:
        clip = clip.mean(axis=1)
    clip = resample_linear(clip, sr, TARGET_SR)
    print(f"clip    {clip.size / TARGET_SR:.2f}s @ {TARGET_SR} Hz (source {sr} Hz)")

    gap = np.zeros(int(GAP_S * TARGET_SR), dtype=np.float32)
    parts: list[np.ndarray] = []
    for i in range(REPEATS):
        if i:
            parts.append(gap)
        parts.append(clip)
    audio = np.concatenate(parts)
    duration = audio.size / TARGET_SR
    sf.write(str(out / "audio.wav"), audio, TARGET_SR, subtype="PCM_16")
    print(f"audio   {out / 'audio.wav'}  ({duration:.2f}s)")

    wall = datetime.now().astimezone().isoformat(timespec="seconds")
    events = [{"t": 0.0, "wall": wall, "type": "start"}]
    for k in range(N_SLIDES):
        t = min(k * SLIDE_EVERY_S, max(0.0, duration - 1.0))
        events.append({"t": round(t, 3), "wall": wall, "type": "slide", "slide": k + 1})
    events.append({"t": round(duration, 3), "wall": wall, "type": "stop"})
    with (out / "events.jsonl").open("w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps(ev) + "\n")
    print(f"events  {out / 'events.jsonl'}  ({N_SLIDES} slides)")

    (out / "recording.json").write_text(
        json.dumps(
            {
                "started_wall": wall,
                "samplerate": TARGET_SR,
                "channels": 1,
                "file": "audio.wav",
                "device": "synthetic",
                "duration_s": round(duration, 3),
            },
            indent=2,
        ) + "\n",
        encoding="utf-8",
    )

    (out / "bias.json").write_text(
        json.dumps(
            {
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
    print(f"  uv run spike transcribe --dir {out} --engine faster-whisper --model tiny.en")
    print(f"  uv run spike sample --dir {out} --n 2 --window-s 30")
    print(f"  uv run python scripts/make_synthetic_lecture.py {out} --seed-references")
    print(f"  uv run spike score --dir {out}")


def seed_references(out: Path) -> int:
    """Overwrite every eval/window-*/reference.txt with the KNOWN transcript.

    Because the synthetic audio is one sentence on a fixed grid, the true text
    of any time window can be computed exactly. Run this after `spike sample`
    and before `spike score` to get a real WER instead of scoring the
    transcript against a copy of itself.
    """
    meta_path = out / "recording.json"
    if not meta_path.exists():
        raise SystemExit(f"no {meta_path}; build the lecture first")
    duration = float(json.loads(meta_path.read_text())["duration_s"])
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
        raise SystemExit("no eval windows; run `spike sample` first")
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out", help="output lecture directory, e.g. data/synthetic")
    ap.add_argument("--seed-references", action="store_true",
                    help="fill eval/window-*/reference.txt with the known transcript "
                         "(run after `spike sample`, instead of hand-correcting)")
    args = ap.parse_args()
    if args.seed_references:
        seed_references(Path(args.out))
        return 0
    build(Path(args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
