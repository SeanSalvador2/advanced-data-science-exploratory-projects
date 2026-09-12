"""Evaluation windows: sample three 5-minute slices, then score them.

`lecture-rec sample` writes eval/window-i/{clip.wav, draft.txt, reference.txt, meta.json}.
The student listens to clip.wav and fixes reference.txt by hand; that hand-fixed
text is the only ground truth in this measurement.

`lecture-rec score` measures every transcript condition against those references.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, Sequence

import numpy as np

from .chunking import load_audio, slice_audio
from .schemas import (
    BiasTerms,
    EvalWindowMeta,
    LectureDir,
    Segment,
    Transcript,
    fmt_mmss,
    read_json,
    write_json,
)

CONDITIONS = ("plain", "biased")


# --------------------------------------------------------------------------- #
# normalization (identical for reference and hypothesis)
# --------------------------------------------------------------------------- #


def _compose():
    import jiwer

    return jiwer.Compose(
        [
            jiwer.ToLowerCase(),
            jiwer.ExpandCommonEnglishContractions(),
            jiwer.RemovePunctuation(),
            jiwer.RemoveMultipleSpaces(),
            jiwer.Strip(),
        ]
    )


_NORM = None


def normalize_text(text: str) -> str:
    """lowercase -> expand contractions -> drop punctuation -> collapse spaces.

    Numbers are left exactly as they are (no digit/word folding), per the brief.
    """
    global _NORM
    if not text or not text.strip():
        return ""
    if _NORM is None:
        _NORM = _compose()
    out = _NORM(text)
    if isinstance(out, list):                       # defensive: jiwer version drift
        out = " ".join(out)
    return re.sub(r"\s+", " ", str(out)).strip()


def _nospace(text: str) -> str:
    return re.sub(r"[\s\-]+", "", text)


def term_present(term: str, normalized_text: str) -> bool:
    """Case-insensitive, hyphen/space-insensitive membership test.

    Single-token terms must match on a word boundary (otherwise "eta" would be
    found inside "theta"); multi-token terms may additionally match with their
    hyphens/spaces collapsed, so "back-propagation" finds "backpropagation".
    """
    t = normalize_text(term)
    if not t or not normalized_text:
        return False
    if f" {t} " in f" {normalized_text} ":
        return True
    if len(t.split()) > 1 or "-" in term:
        return _nospace(t) in _nospace(normalized_text)
    return False


# --------------------------------------------------------------------------- #
# sample
# --------------------------------------------------------------------------- #


def window_fractions(n: int) -> list[float]:
    """20% / 50% / 80% for n=3; evenly spread over the same range otherwise."""
    if n <= 0:
        return []
    if n == 1:
        return [0.5]
    return [0.2 + (0.6 * i / (n - 1)) for i in range(n)]


def segments_in_span(segments: Sequence[Segment], start: float, end: float) -> list[Segment]:
    return [s for s in segments if s.start < end and s.end > start]


def snap_window(
    segments: Sequence[Segment], center: float, window_s: float, floor: float = 0.0
) -> tuple[float, float, list[Segment]]:
    """Grow/shrink [center +/- window/2] out to whole piece boundaries."""
    want_start = max(floor, center - window_s / 2.0)
    want_end = center + window_s / 2.0
    chosen = segments_in_span(segments, want_start, want_end)
    chosen = [s for s in chosen if s.end > floor]
    if not chosen:
        return want_start, want_end, []
    return chosen[0].start, chosen[-1].end, chosen


def run_sample(
    dir_path: str | Path,
    n: int = 3,
    window_s: float = 300.0,
    condition: str = "plain",
) -> list[EvalWindowMeta]:
    ld = LectureDir(dir_path)
    transcript = ld.load_transcript(condition)
    if transcript is None:
        raise SystemExit(
            f"no transcripts/{condition}.json - run "
            "`lecture-rec transcribe <dir> --eval` first"
        )
    if not ld.audio.exists():
        raise SystemExit(f"no audio at {ld.audio}")

    import soundfile as sf

    audio, sr = load_audio(ld.audio)
    duration = audio.size / float(sr)
    segments = sorted(transcript.segments, key=lambda s: s.start)

    metas: list[EvalWindowMeta] = []
    floor = 0.0
    for i, frac in enumerate(window_fractions(n), start=1):
        start, end, chosen = snap_window(segments, frac * duration, window_s, floor)
        if not chosen:
            print(f"window {i}: no transcript segments near {fmt_mmss(frac * duration)}"
                  " - skipped")
            continue
        floor = end

        wdir = ld.window(i)
        wdir.mkdir(parents=True, exist_ok=True)

        sf.write(str(wdir / "clip.wav"), slice_audio(audio, sr, start, end), sr,
                 subtype="PCM_16")

        draft = "\n".join(s.text.strip() for s in chosen if s.text.strip()) + "\n"
        (wdir / "draft.txt").write_text(draft, encoding="utf-8")

        ref = wdir / "reference.txt"
        if ref.exists() and ref.read_text(encoding="utf-8") != draft:
            print(f"window {i}: reference.txt already edited - left untouched")
        else:
            ref.write_text(draft, encoding="utf-8")

        slides = sorted({s.slide for s in chosen if s.slide is not None})
        meta = EvalWindowMeta(index=i, start=start, end=end, slides=slides)
        write_json(wdir / "meta.json", meta.to_dict())
        metas.append(meta)

        print(
            f"window {i}: {fmt_mmss(start)}-{fmt_mmss(end)} "
            f"({end - start:.0f}s, {len(chosen)} segments, slides "
            f"{slides or ['-']}) -> {wdir}"
        )

    if metas:
        print()
        print("Now: play each clip.wav and fix that window's reference.txt by hand.")
        print("Fix only real errors; keep the line breaks. Then run `lecture-rec score`.")
    return metas


# --------------------------------------------------------------------------- #
# score
# --------------------------------------------------------------------------- #


@dataclass
class WindowScore:
    index: int
    condition: str
    start: float
    end: float
    wer: float                          # fraction, not %
    ref_words: int
    recall: float                       # fraction
    terms_expected: int                 # bias terms actually in the reference
    terms_found: int
    missed_terms: list[str] = field(default_factory=list)
    reference: str = ""
    hypothesis: str = ""


def expected_terms(bias: BiasTerms, slides: Sequence[int]) -> list[str]:
    """global terms union the per-page terms of every slide in the window."""
    seen: dict[str, str] = {}
    for t in bias.global_terms:
        seen.setdefault(t.lower(), t)
    for slide in slides:
        for p in bias.pages:
            if p.page == slide:
                for t in p.terms:
                    seen.setdefault(t.lower(), t)
    return list(seen.values())


def load_windows(ld: LectureDir) -> list[EvalWindowMeta]:
    if not ld.eval.exists():
        return []
    out = []
    for d in sorted(ld.eval.glob("window-*")):
        meta = d / "meta.json"
        if meta.exists():
            out.append(EvalWindowMeta.from_dict(read_json(meta)))
    return sorted(out, key=lambda m: m.index)


def hypothesis_for_window(transcript: Transcript, meta: EvalWindowMeta) -> str:
    chosen = segments_in_span(
        sorted(transcript.segments, key=lambda s: s.start), meta.start, meta.end
    )
    return " ".join(s.text.strip() for s in chosen if s.text.strip())


def score_window(
    meta: EvalWindowMeta,
    reference_raw: str,
    hypothesis_raw: str,
    condition: str,
    bias: BiasTerms,
) -> WindowScore:
    import jiwer

    ref = normalize_text(reference_raw)
    hyp = normalize_text(hypothesis_raw)

    if ref:
        out = jiwer.process_words(
            ref,
            hyp,
            reference_transform=jiwer.Compose([jiwer.ReduceToListOfListOfWords()]),
            hypothesis_transform=jiwer.Compose([jiwer.ReduceToListOfListOfWords()]),
        )
        wer = float(out.wer)
    else:
        wer = float("nan")

    terms = expected_terms(bias, meta.slides)
    in_ref = [t for t in terms if term_present(t, ref)]
    found = [t for t in in_ref if term_present(t, hyp)]
    missed = [t for t in in_ref if t not in found]
    recall = (len(found) / len(in_ref)) if in_ref else float("nan")

    return WindowScore(
        index=meta.index,
        condition=condition,
        start=meta.start,
        end=meta.end,
        wer=wer,
        ref_words=len(ref.split()),
        recall=recall,
        terms_expected=len(in_ref),
        terms_found=len(found),
        missed_terms=missed,
        reference=ref,
        hypothesis=hyp,
    )


@dataclass
class PooledScore:
    condition: str
    wer: float
    recall: float
    terms_expected: int
    terms_found: int
    windows: int


def pool(scores: Sequence[WindowScore], condition: str) -> PooledScore:
    import jiwer

    rows = [s for s in scores if s.condition == condition and s.reference]
    if not rows:
        return PooledScore(condition, float("nan"), float("nan"), 0, 0, 0)

    out = jiwer.process_words(
        [s.reference for s in rows],
        [s.hypothesis for s in rows],
        reference_transform=jiwer.Compose([jiwer.ReduceToListOfListOfWords()]),
        hypothesis_transform=jiwer.Compose([jiwer.ReduceToListOfListOfWords()]),
    )
    expected = sum(s.terms_expected for s in rows)
    found = sum(s.terms_found for s in rows)
    return PooledScore(
        condition=condition,
        wer=float(out.wer),
        recall=(found / expected) if expected else float("nan"),
        terms_expected=expected,
        terms_found=found,
        windows=len(rows),
    )


def run_score(dir_path: str | Path) -> tuple[list[WindowScore], dict[str, PooledScore]]:
    from .report import build_report

    ld = LectureDir(dir_path)
    windows = load_windows(ld)
    if not windows:
        raise SystemExit(f"no eval windows in {ld.eval} - run `lecture-rec sample` first")

    bias = ld.load_bias()
    transcripts = {c: ld.load_transcript(c) for c in CONDITIONS}
    transcripts = {c: t for c, t in transcripts.items() if t is not None}
    if not transcripts:
        raise SystemExit("no transcripts to score - run "
                         "`lecture-rec transcribe <dir> --eval` first")

    scores: list[WindowScore] = []
    unedited: list[int] = []
    for meta in windows:
        wdir = ld.window(meta.index)
        ref_path = wdir / "reference.txt"
        if not ref_path.exists():
            print(f"window {meta.index}: no reference.txt - skipped")
            continue
        reference = ref_path.read_text(encoding="utf-8")
        draft_path = wdir / "draft.txt"
        if draft_path.exists() and draft_path.read_text(encoding="utf-8") == reference:
            unedited.append(meta.index)
        for cond, tr in transcripts.items():
            scores.append(
                score_window(meta, reference, hypothesis_for_window(tr, meta), cond, bias)
            )

    pooled = {c: pool(scores, c) for c in transcripts}
    report = build_report(ld, scores, pooled, unedited, transcripts)
    ld.report.write_text(report, encoding="utf-8")
    print(report)
    print(f"(written to {ld.report})")
    return scores, pooled
