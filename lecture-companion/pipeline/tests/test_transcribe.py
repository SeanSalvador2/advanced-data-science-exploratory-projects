"""What `transcribe` writes, and where.

The engine is stubbed out: these tests are about the production-vs-eval output
contract and about app-written events landing on the right slide, not about ASR
quality (tests/test_integration.py runs a real model for that).
"""

from __future__ import annotations

import json
import shutil
import subprocess
from datetime import timedelta
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from lecture_rec.engines import Engine, PieceResult
from lecture_rec.schemas import LectureDir, parse_iso, read_json
from lecture_rec.transcribe import run_transcribe

SR = 16000
DURATION_S = 40.0
START = "2026-01-01T09:00:00.000+00:00"
NODE_CLI = Path(__file__).resolve().parents[2] / "cli" / "bin" / "lecture.mjs"


class StubEngine(Engine):
    name = "stub"
    model_name = "stub-1"
    supports_bias = True

    def __init__(self):
        self.prompts: list[str] = []

    def transcribe_piece(self, audio, sr, prompt):
        self.prompts.append(prompt)
        return PieceResult(text="fellow americans",
                           words=[("fellow", 0.0, 0.5), ("americans", 0.5, 1.0)])


class NoBiasEngine(StubEngine):
    name = "stub-nobias"
    supports_bias = False


def wall_at(offset_s: float) -> str:
    return (parse_iso(START) + timedelta(seconds=offset_s)).isoformat(
        timespec="milliseconds")


@pytest.fixture
def lecture(tmp_path, monkeypatch):
    """An app-style lecture folder: camelCase recording.json, slide events with
    a wall clock only."""
    out = tmp_path / "lec"
    out.mkdir()
    rng = np.random.default_rng(0)
    audio = (rng.standard_normal(int(DURATION_S * SR)) * 0.1).astype(np.float32)
    sf.write(str(out / "audio.wav"), audio, SR, subtype="PCM_16")

    events = [
        {"t": 0.0, "wall": wall_at(0.0), "type": "start", "source": "recorder"},
        {"wall": wall_at(0.0), "type": "slide", "slide": 1, "source": "app"},
        {"wall": wall_at(20.0), "type": "slide", "slide": 2, "source": "app"},
        {"t": DURATION_S, "wall": wall_at(DURATION_S), "type": "stop",
         "source": "recorder"},
    ]
    (out / "events.jsonl").write_text(
        "".join(json.dumps(e) + "\n" for e in events), encoding="utf-8")
    (out / "recording.json").write_text(json.dumps({
        "schema": "recording/1",
        "startedWall": START,
        "stoppedWall": wall_at(DURATION_S),
        "durationS": DURATION_S,
        "sampleRate": SR, "channels": 1, "device": "synthetic", "file": "audio.wav",
    }, indent=2) + "\n", encoding="utf-8")
    (out / "bias.json").write_text(json.dumps({
        "schema": "bias/1", "deck": "deck.pdf", "source": "derived",
        "pages": [{"page": 1, "terms": ["inaugural"]},
                  {"page": 2, "terms": ["Wasserstein"]}],
        "global": ["Americans"],
    }, indent=2) + "\n", encoding="utf-8")

    engine = StubEngine()
    monkeypatch.setattr("lecture_rec.transcribe.select_engine",
                        lambda name, model: engine)
    return out, engine


def test_production_run_writes_one_biased_transcript(lecture, capsys):
    out, engine = lecture
    run_transcribe(out, max_piece_s=30.0)
    ld = LectureDir(out)

    assert ld.transcript.exists()
    assert not ld.transcripts.exists(), "eval output belongs to --eval only"
    raw = read_json(ld.transcript)
    assert raw["schema"] == "transcript/1"
    assert raw["condition"] == "biased"
    assert raw["engine"] == "stub" and raw["model"] == "stub-1"
    assert [s["slide"] for s in raw["segments"]] == [1, 2]
    assert raw["segments"][0]["prompt"] == "inaugural"
    assert raw["segments"][1]["prompt"] == "Wasserstein"
    assert ld.transcript_text.exists()


def test_slide_numbers_come_from_the_apps_wall_clock_events(lecture):
    out, _ = lecture
    run_transcribe(out, max_piece_s=30.0)
    segments = read_json(LectureDir(out).transcript)["segments"]
    assert [(s["slide"], round(s["start"]), round(s["end"])) for s in segments] == [
        (1, 0, 20), (2, 20, 40)
    ]


def test_production_falls_back_to_plain_without_bias_json(lecture, capsys):
    out, _ = lecture
    (out / "bias.json").unlink()
    run_transcribe(out, max_piece_s=30.0)
    raw = read_json(LectureDir(out).transcript)
    assert raw["condition"] == "plain"
    assert all(s["prompt"] == "" for s in raw["segments"])
    printed = capsys.readouterr().out
    assert "bias.json" in printed and "plain" in printed


def test_production_falls_back_to_plain_for_an_engine_without_biasing(
        lecture, monkeypatch, capsys):
    out, _ = lecture
    monkeypatch.setattr("lecture_rec.transcribe.select_engine",
                        lambda name, model: NoBiasEngine())
    run_transcribe(out, max_piece_s=30.0)
    assert read_json(LectureDir(out).transcript)["condition"] == "plain"
    assert "no prompt/bias input" in capsys.readouterr().out


def test_eval_run_writes_both_conditions_under_transcripts(lecture):
    out, _ = lecture
    run_transcribe(out, max_piece_s=30.0, eval_mode=True)
    ld = LectureDir(out)
    assert not ld.transcript.exists()
    for condition in ("plain", "biased"):
        raw = read_json(ld.transcript_json(condition))
        assert raw["schema"] == "transcript/1"
        assert raw["condition"] == condition
        assert ld.transcript_txt(condition).exists()
    plain = read_json(ld.transcript_json("plain"))
    biased = read_json(ld.transcript_json("biased"))
    assert [(s["start"], s["end"]) for s in plain["segments"]] == \
           [(s["start"], s["end"]) for s in biased["segments"]]
    assert all(s["prompt"] == "" for s in plain["segments"])
    assert any(s["prompt"] for s in biased["segments"])


def test_transcript_json_validates_against_the_typescript_contract(lecture):
    if shutil.which("node") is None:
        pytest.skip("node is not installed; cannot cross-check the TS contract")
    if not NODE_CLI.exists():
        pytest.skip(f"{NODE_CLI} is not built; run `npm run build` in lecture-companion")
    out, _ = lecture
    run_transcribe(out, max_piece_s=30.0)
    res = subprocess.run(
        ["node", str(NODE_CLI), "validate", str(LectureDir(out).transcript)],
        capture_output=True, text=True,
    )
    assert res.returncode == 0, res.stdout + res.stderr
    assert "ok" in res.stdout and "transcript/1" in res.stdout


def test_phase_0_folders_still_transcribe(lecture):
    """snake_case recording.json, every event carrying `t`: the Phase 0 shape."""
    out, _ = lecture
    (out / "recording.json").write_text(json.dumps({
        "started_wall": "2026-01-01T09:00:00+00:00", "samplerate": SR,
        "channels": 1, "file": "audio.wav", "device": "synthetic",
        "duration_s": DURATION_S,
    }, indent=2) + "\n", encoding="utf-8")
    (out / "events.jsonl").write_text("".join(json.dumps(e) + "\n" for e in [
        {"t": 0.0, "wall": "2026-01-01T09:00:00+00:00", "type": "start"},
        {"t": 0.0, "wall": "2026-01-01T09:00:00+00:00", "type": "slide", "slide": 1},
        {"t": 20.0, "wall": "2026-01-01T09:00:20+00:00", "type": "slide", "slide": 2},
        {"t": DURATION_S, "wall": "2026-01-01T09:00:40+00:00", "type": "stop"},
    ]), encoding="utf-8")
    run_transcribe(out, max_piece_s=30.0, eval_mode=True)
    raw = read_json(LectureDir(out).transcript_json("biased"))
    assert [s["slide"] for s in raw["segments"]] == [1, 2]


def test_resume_keeps_finished_pieces(lecture):
    out, engine = lecture
    run_transcribe(out, max_piece_s=10.0)
    done = len(read_json(LectureDir(out).transcript)["segments"])
    calls = len(engine.prompts)
    run_transcribe(out, max_piece_s=10.0, resume=True)
    assert len(engine.prompts) == calls, "resume must not re-decode anything"
    assert len(read_json(LectureDir(out).transcript)["segments"]) == done
