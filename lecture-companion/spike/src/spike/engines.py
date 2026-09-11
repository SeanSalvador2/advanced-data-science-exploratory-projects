"""One interface over the local ASR backends. Nothing here touches a network
except the first-run model download, and nothing here needs an API key.

    engine = select_engine("auto")            # mlx-whisper on Apple Silicon
    res = engine.transcribe_piece(audio, 16000, prompt)

Every heavy import is lazy so `import spike.engines` stays cheap (and works on
a machine where only one of the backends is installed).
"""

from __future__ import annotations

import importlib.util
import platform
from dataclasses import dataclass, field
from typing import Optional

import numpy as np

DEFAULT_MODELS = {
    "mlx-whisper": "mlx-community/whisper-large-v3-turbo",
    "faster-whisper": "large-v3-turbo",
    "parakeet": "mlx-community/parakeet-tdt-0.6b-v3",
}

TARGET_SR = 16000


@dataclass
class PieceResult:
    """One decoded piece. Word times are RELATIVE to the start of the piece."""

    text: str
    words: list[tuple[str, float, float]] = field(default_factory=list)


def have(module: str) -> bool:
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):       # pragma: no cover
        return False


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def resample_linear(audio: np.ndarray, sr: int, target_sr: int = TARGET_SR) -> np.ndarray:
    """Linear-interpolation resample. Deliberately dependency-free (no ffmpeg)."""
    if sr == target_sr or audio.size == 0:
        return np.ascontiguousarray(audio, dtype=np.float32)
    n_out = int(round(audio.size * target_sr / float(sr)))
    if n_out <= 1:
        return np.zeros(0, dtype=np.float32)
    x_old = np.arange(audio.size, dtype=np.float64)
    x_new = np.linspace(0.0, audio.size - 1, n_out, dtype=np.float64)
    return np.interp(x_new, x_old, audio.astype(np.float64)).astype(np.float32)


class Engine:
    """Interface. `supports_bias` is False for engines with no prompt input."""

    name: str = "engine"
    model_name: str = ""
    supports_bias: bool = True

    def transcribe_piece(self, audio: np.ndarray, sr: int, prompt: str) -> PieceResult:
        raise NotImplementedError


# --------------------------------------------------------------------------- #
# faster-whisper (CPU, works everywhere including this Linux container)
# --------------------------------------------------------------------------- #


class FasterWhisperEngine(Engine):
    name = "faster-whisper"

    def __init__(self, model: Optional[str] = None, device: str = "cpu",
                 compute_type: str = "int8"):
        from faster_whisper import WhisperModel

        self.model_name = model or DEFAULT_MODELS["faster-whisper"]
        self._model = WhisperModel(
            self.model_name, device=device, compute_type=compute_type
        )

    def transcribe_piece(self, audio: np.ndarray, sr: int, prompt: str) -> PieceResult:
        audio = resample_linear(np.asarray(audio, dtype=np.float32), sr)
        # Signature verified against faster-whisper 1.2.1.
        segments, _info = self._model.transcribe(
            audio,
            initial_prompt=prompt or None,
            word_timestamps=True,
            language="en",
            condition_on_previous_text=False,
            vad_filter=False,
        )
        texts: list[str] = []
        words: list[tuple[str, float, float]] = []
        for seg in segments:                    # generator: consuming it runs the decode
            texts.append(seg.text)
            for w in (seg.words or []):
                words.append((w.word.strip(), float(w.start), float(w.end)))
        return PieceResult(text=" ".join(t.strip() for t in texts).strip(), words=words)


# --------------------------------------------------------------------------- #
# mlx-whisper (Apple Silicon; the fast path on the MacBook Air)
# --------------------------------------------------------------------------- #


class MLXWhisperEngine(Engine):
    name = "mlx-whisper"

    def __init__(self, model: Optional[str] = None):
        import mlx_whisper  # noqa: F401  (fail early if it is not installed)

        self.model_name = model or DEFAULT_MODELS["mlx-whisper"]
        self._mlx_whisper = mlx_whisper

    def transcribe_piece(self, audio: np.ndarray, sr: int, prompt: str) -> PieceResult:
        audio = resample_linear(np.asarray(audio, dtype=np.float32), sr)
        result = self._mlx_whisper.transcribe(
            audio,
            path_or_hf_repo=self.model_name,
            initial_prompt=prompt or None,
            word_timestamps=True,
            language="en",
            condition_on_previous_text=False,
        )
        words: list[tuple[str, float, float]] = []
        for seg in result.get("segments", []) or []:
            for w in seg.get("words", []) or []:
                words.append(
                    (str(w.get("word", "")).strip(),
                     float(w.get("start", 0.0)),
                     float(w.get("end", 0.0)))
                )
        return PieceResult(text=str(result.get("text", "")).strip(), words=words)


# --------------------------------------------------------------------------- #
# parakeet-mlx (Apple Silicon; no prompt input, so plain condition only)
# --------------------------------------------------------------------------- #


class ParakeetEngine(Engine):
    name = "parakeet"
    supports_bias = False

    def __init__(self, model: Optional[str] = None):
        from parakeet_mlx import from_pretrained

        self.model_name = model or DEFAULT_MODELS["parakeet"]
        self._model = from_pretrained(self.model_name)

    def transcribe_piece(self, audio: np.ndarray, sr: int, prompt: str) -> PieceResult:
        # parakeet-mlx takes a file path, so the piece goes through a temp WAV.
        # soundfile writes it directly; still no ffmpeg anywhere.
        import tempfile
        from pathlib import Path

        import soundfile as sf

        audio = resample_linear(np.asarray(audio, dtype=np.float32), sr)
        with tempfile.TemporaryDirectory() as td:
            wav = Path(td) / "piece.wav"
            sf.write(str(wav), audio, TARGET_SR, subtype="PCM_16")
            result = self._model.transcribe(str(wav))

        text = str(getattr(result, "text", "") or "").strip()
        words: list[tuple[str, float, float]] = []
        for tok in (getattr(result, "tokens", None) or []):
            w = str(getattr(tok, "text", "") or "").strip()
            if w:
                words.append(
                    (w, float(getattr(tok, "start", 0.0)), float(getattr(tok, "end", 0.0)))
                )
        if not words:
            for sent in (getattr(result, "sentences", None) or []):
                w = str(getattr(sent, "text", "") or "").strip()
                if w:
                    words.append(
                        (w, float(getattr(sent, "start", 0.0)),
                         float(getattr(sent, "end", 0.0)))
                    )
        return PieceResult(text=text, words=words)


# --------------------------------------------------------------------------- #
# selection
# --------------------------------------------------------------------------- #


def resolve_engine_name(engine: str = "auto") -> str:
    if engine != "auto":
        return engine
    if is_apple_silicon() and have("mlx_whisper"):
        return "mlx-whisper"
    return "faster-whisper"


def select_engine(engine: str = "auto", model: Optional[str] = None) -> Engine:
    name = resolve_engine_name(engine)
    if name == "mlx-whisper":
        return MLXWhisperEngine(model)
    if name == "faster-whisper":
        return FasterWhisperEngine(model)
    if name == "parakeet":
        return ParakeetEngine(model)
    raise SystemExit(
        f"unknown engine {name!r}; pick auto, faster-whisper, mlx-whisper or parakeet"
    )
