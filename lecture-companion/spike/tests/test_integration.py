"""End-to-end: synthetic lecture -> transcribe -> sample -> score.

Marked slow because it downloads the `tiny.en` model (~75 MB) and the JFK clip
the first time. Run everything else with `pytest -m "not slow"`.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from spike.evalwin import run_sample, run_score
from spike.schemas import LectureDir, Transcript, read_json
from spike.transcribe import run_transcribe

REPO = Path(__file__).resolve().parents[1]
BUILDER = REPO / "scripts" / "make_synthetic_lecture.py"


@pytest.mark.slow
def test_full_pipeline_on_the_synthetic_lecture(tmp_path):
    out = tmp_path / "synthetic"
    subprocess.run([sys.executable, str(BUILDER), str(out)], check=True, cwd=REPO)

    ld = LectureDir(out)
    assert ld.audio.exists() and ld.events.exists() and ld.bias.exists()

    run_transcribe(out, engine_name="faster-whisper", model="tiny.en")

    for condition in ("plain", "biased"):
        raw = read_json(ld.transcript_json(condition))
        assert set(raw) == {"engine", "model", "condition", "created", "segments"}
        assert raw["engine"] == "faster-whisper"
        assert raw["model"] == "tiny.en"
        assert raw["condition"] == condition

        tr = Transcript.from_dict(raw)
        assert len(tr.segments) == 4
        assert [s.slide for s in tr.segments] == [1, 2, 3, 4]
        starts = [s.start for s in tr.segments]
        assert starts == sorted(starts) and len(set(starts)) == len(starts)
        for s in tr.segments:
            assert s.end > s.start
            assert "fellow" in s.text.lower()
            assert s.words and s.words[0].start >= s.start - 1e-6
        assert ld.transcript_txt(condition).read_text().count("[slide ") == 4

    plain = Transcript.from_dict(read_json(ld.transcript_json("plain")))
    biased = Transcript.from_dict(read_json(ld.transcript_json("biased")))
    assert [(s.start, s.end) for s in plain.segments] == \
           [(s.start, s.end) for s in biased.segments], "pieces must match across conditions"
    assert all(s.prompt == "" for s in plain.segments)
    assert any(s.prompt for s in biased.segments)

    run_sample(out, n=2, window_s=30.0)
    subprocess.run([sys.executable, str(BUILDER), str(out), "--seed-references"],
                   check=True, cwd=REPO)

    scores, pooled = run_score(out)
    assert ld.report.exists()
    report = ld.report.read_text()
    assert "## Verdict" in report and "WER" in report
    assert pooled["plain"].wer < 0.20, f"tiny.en WER too high: {pooled['plain'].wer}"
    assert pooled["biased"].wer < 0.20
    assert pooled["plain"].recall == 1.0


@pytest.mark.slow
def test_resume_skips_finished_pieces(tmp_path):
    out = tmp_path / "synthetic"
    subprocess.run([sys.executable, str(BUILDER), str(out)], check=True, cwd=REPO)
    run_transcribe(out, engine_name="faster-whisper", model="tiny.en",
                   conditions=["plain"])
    ld = LectureDir(out)
    before = read_json(ld.transcript_json("plain"))

    run_transcribe(out, engine_name="faster-whisper", model="tiny.en",
                   conditions=["plain"], resume=True)
    after = read_json(ld.transcript_json("plain"))
    assert [s["text"] for s in before["segments"]] == [s["text"] for s in after["segments"]]
