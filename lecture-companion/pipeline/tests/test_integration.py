"""End-to-end on the synthetic lecture, with a real (tiny) model.

Two paths:
  * the production path on an app-style folder - camelCase `recording.json`,
    slide events carrying a wall clock only - ending in `transcript.json`;
  * the eval path on a Phase 0 folder, ending in `report.md`.

Marked slow because it downloads the `tiny.en` model (~75 MB) and the JFK clip
the first time. Run everything else with `pytest -m "not slow"`.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from lecture_rec.evalwin import run_sample, run_score
from lecture_rec.schemas import LectureDir, Transcript, read_json
from lecture_rec.transcribe import run_transcribe

REPO = Path(__file__).resolve().parents[1]
BUILDER = REPO / "scripts" / "make_synthetic_lecture.py"
NODE_CLI = REPO.parent / "cli" / "bin" / "lecture.mjs"


def validate_with_node(path: Path) -> None:
    """Cross-check one file against the zod schemas in packages/core."""
    if shutil.which("node") is None or not NODE_CLI.exists():
        pytest.skip("node or the built Node CLI is unavailable")
    res = subprocess.run(["node", str(NODE_CLI), "validate", str(path)],
                         capture_output=True, text=True)
    assert res.returncode == 0, res.stdout + res.stderr
    assert res.stdout.startswith("ok"), res.stdout


@pytest.mark.slow
def test_production_run_on_an_app_style_lecture(tmp_path):
    """The lecture-day path: recorder start/stop, app slide events, one
    transcript.json that validates against the TypeScript contracts."""
    out = tmp_path / "synthetic-app"
    subprocess.run([sys.executable, str(BUILDER), str(out), "--app-events"],
                   check=True, cwd=REPO)

    events = [json.loads(line) for line in
              (out / "events.jsonl").read_text().splitlines() if line.strip()]
    assert [e["type"] for e in events] == ["start", "slide", "slide", "slide",
                                           "slide", "stop"]
    assert all("t" not in e for e in events if e["type"] == "slide")
    assert all(e["source"] == "app" for e in events if e["type"] == "slide")
    assert read_json(out / "recording.json")["schema"] == "recording/1"

    run_transcribe(out, engine_name="faster-whisper", model="tiny.en")

    ld = LectureDir(out)
    raw = read_json(ld.transcript)
    assert set(raw) == {"schema", "engine", "model", "condition", "created",
                        "segments"}
    assert raw["schema"] == "transcript/1"
    assert raw["condition"] == "biased"
    tr = Transcript.from_dict(raw)
    assert [s.slide for s in tr.segments] == [1, 2, 3, 4]
    for s in tr.segments:
        assert s.end > s.start and "fellow" in s.text.lower()
    assert not ld.transcripts.exists()

    validate_with_node(ld.transcript)
    validate_with_node(out / "recording.json")


@pytest.mark.slow
def test_full_eval_pipeline_on_a_phase_0_synthetic_lecture(tmp_path):
    """Backward compatibility: a folder the Phase 0 recorder could have written still
    transcribes, samples and scores."""
    out = tmp_path / "synthetic"
    subprocess.run([sys.executable, str(BUILDER), str(out)], check=True, cwd=REPO)

    ld = LectureDir(out)
    assert ld.audio.exists() and ld.events.exists() and ld.bias.exists()
    assert "started_wall" in read_json(ld.recording), "the Phase 0 spelling"

    run_transcribe(out, engine_name="faster-whisper", model="tiny.en",
                   eval_mode=True)

    for condition in ("plain", "biased"):
        raw = read_json(ld.transcript_json(condition))
        assert set(raw) == {"schema", "engine", "model", "condition", "created",
                            "segments"}
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
                   conditions=["plain"], eval_mode=True)
    ld = LectureDir(out)
    before = read_json(ld.transcript_json("plain"))

    run_transcribe(out, engine_name="faster-whisper", model="tiny.en",
                   conditions=["plain"], resume=True, eval_mode=True)
    after = read_json(ld.transcript_json("plain"))
    assert [s["text"] for s in before["segments"]] == [s["text"] for s in after["segments"]]
