"""Dataclasses + JSON (de)serialization for every on-disk contract.

Every file the CLI writes into a lecture directory has its shape defined here.
Nothing else in the package should build these dicts by hand.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Literal, Optional

EventType = Literal["start", "slide", "note", "stop"]
Condition = Literal["plain", "biased"]

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def now_iso() -> str:
    """Local time, ISO-8601, with a UTC offset."""
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _drop_none(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(p)


# --------------------------------------------------------------------------- #
# Event  (events.jsonl, one per line)
# --------------------------------------------------------------------------- #


@dataclass
class Event:
    t: float                      # seconds since audio stream start (audio clock)
    wall: str                     # ISO-8601 local time with offset
    type: EventType
    slide: Optional[int] = None   # 1-based, present for type == "slide"
    text: Optional[str] = None    # present for type == "note"

    def to_dict(self) -> dict[str, Any]:
        return _drop_none(
            {"t": float(self.t), "wall": self.wall, "type": self.type,
             "slide": self.slide, "text": self.text}
        )

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            t=float(d["t"]),
            wall=d["wall"],
            type=d["type"],
            slide=int(d["slide"]) if d.get("slide") is not None else None,
            text=d.get("text"),
        )


def append_event(path: Path, ev: Event) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(ev.to_dict(), ensure_ascii=False) + "\n")
        fh.flush()


def read_events(path: Path) -> list[Event]:
    p = Path(path)
    if not p.exists():
        return []
    out: list[Event] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(Event.from_dict(json.loads(line)))
    return out


def write_events(path: Path, events: Iterable[Event]) -> None:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("w", encoding="utf-8") as fh:
        for ev in events:
            fh.write(json.dumps(ev.to_dict(), ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# RecordingMeta  (recording.json)
# --------------------------------------------------------------------------- #


@dataclass
class RecordingMeta:
    started_wall: str
    samplerate: int = 16000
    channels: int = 1
    file: str = "audio.wav"
    device: str = ""
    duration_s: Optional[float] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "started_wall": self.started_wall,
            "samplerate": int(self.samplerate),
            "channels": int(self.channels),
            "file": self.file,
            "device": self.device,
            "duration_s": None if self.duration_s is None else float(self.duration_s),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RecordingMeta":
        return cls(
            started_wall=d["started_wall"],
            samplerate=int(d.get("samplerate", 16000)),
            channels=int(d.get("channels", 1)),
            file=d.get("file", "audio.wav"),
            device=d.get("device", ""),
            duration_s=None if d.get("duration_s") is None else float(d["duration_s"]),
        )


# --------------------------------------------------------------------------- #
# BiasTerms  (bias.json)
# --------------------------------------------------------------------------- #

MAX_PAGE_TERMS = 40
MAX_GLOBAL_TERMS = 60


@dataclass
class PageTerms:
    page: int              # 1-based
    terms: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"page": int(self.page), "terms": list(self.terms[:MAX_PAGE_TERMS])}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "PageTerms":
        return cls(page=int(d["page"]), terms=[str(t) for t in d.get("terms", [])])


@dataclass
class BiasTerms:
    deck: str = "deck.pdf"
    source: Literal["heuristic", "claude"] = "heuristic"
    pages: list[PageTerms] = field(default_factory=list)
    global_terms: list[str] = field(default_factory=list)   # serialized as "global"

    def to_dict(self) -> dict[str, Any]:
        return {
            "deck": self.deck,
            "source": self.source,
            "pages": [p.to_dict() for p in self.pages],
            "global": list(self.global_terms[:MAX_GLOBAL_TERMS]),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "BiasTerms":
        return cls(
            deck=d.get("deck", "deck.pdf"),
            source=d.get("source", "heuristic"),
            pages=[PageTerms.from_dict(p) for p in d.get("pages", [])],
            global_terms=[str(t) for t in d.get("global", [])],
        )

    def terms_for_slide(self, slide: Optional[int]) -> list[str]:
        """Per-page terms for a 1-based slide number, falling back to the global list."""
        if slide is not None:
            for p in self.pages:
                if p.page == slide and p.terms:
                    return list(p.terms)
        return list(self.global_terms)


# --------------------------------------------------------------------------- #
# Transcript  (transcripts/*.json)
# --------------------------------------------------------------------------- #


@dataclass
class Word:
    w: str
    start: float
    end: float

    def to_dict(self) -> dict[str, Any]:
        return {"w": self.w, "start": float(self.start), "end": float(self.end)}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Word":
        return cls(w=d["w"], start=float(d["start"]), end=float(d["end"]))


@dataclass
class Segment:
    id: int
    slide: Optional[int]
    start: float          # seconds since stream start
    end: float
    prompt: str
    text: str
    words: list[Word] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": int(self.id),
            "slide": None if self.slide is None else int(self.slide),
            "start": float(self.start),
            "end": float(self.end),
            "prompt": self.prompt,
            "text": self.text,
            "words": [w.to_dict() for w in self.words],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Segment":
        return cls(
            id=int(d["id"]),
            slide=None if d.get("slide") is None else int(d["slide"]),
            start=float(d["start"]),
            end=float(d["end"]),
            prompt=d.get("prompt", ""),
            text=d.get("text", ""),
            words=[Word.from_dict(w) for w in d.get("words", [])],
        )


@dataclass
class Transcript:
    engine: str
    model: str
    condition: Condition
    created: str
    segments: list[Segment] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "engine": self.engine,
            "model": self.model,
            "condition": self.condition,
            "created": self.created,
            "segments": [s.to_dict() for s in self.segments],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Transcript":
        return cls(
            engine=d["engine"],
            model=d["model"],
            condition=d["condition"],
            created=d["created"],
            segments=[Segment.from_dict(s) for s in d.get("segments", [])],
        )

    def to_text(self) -> str:
        """Human-readable: one segment per line, '[slide 7 | 12:03-12:31] text'."""
        return "\n".join(
            f"[slide {'-' if s.slide is None else s.slide} | "
            f"{fmt_mmss(s.start)}-{fmt_mmss(s.end)}] {s.text}".rstrip()
            for s in self.segments
        ) + ("\n" if self.segments else "")


def fmt_mmss(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    total = int(round(seconds))
    return f"{total // 60:02d}:{total % 60:02d}"


# --------------------------------------------------------------------------- #
# EvalWindow meta  (eval/window-i/meta.json)
# --------------------------------------------------------------------------- #


@dataclass
class EvalWindowMeta:
    index: int
    start: float
    end: float
    slides: list[int] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "index": int(self.index),
            "start": float(self.start),
            "end": float(self.end),
            "slides": [int(s) for s in self.slides],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "EvalWindowMeta":
        return cls(
            index=int(d["index"]),
            start=float(d["start"]),
            end=float(d["end"]),
            slides=[int(s) for s in d.get("slides", [])],
        )


# --------------------------------------------------------------------------- #
# lecture-directory paths
# --------------------------------------------------------------------------- #


class LectureDir:
    """Every path inside one lecture directory, in one place."""

    def __init__(self, root: str | Path):
        self.root = Path(root)

    def __fspath__(self) -> str:
        return str(self.root)

    @property
    def deck(self) -> Path:
        return self.root / "deck.pdf"

    @property
    def deck_txt(self) -> Path:
        return self.root / "deck.txt"

    @property
    def audio(self) -> Path:
        return self.root / "audio.wav"

    @property
    def recording(self) -> Path:
        return self.root / "recording.json"

    @property
    def events(self) -> Path:
        return self.root / "events.jsonl"

    @property
    def bias(self) -> Path:
        return self.root / "bias.json"

    @property
    def transcripts(self) -> Path:
        return self.root / "transcripts"

    def transcript_json(self, condition: str) -> Path:
        return self.transcripts / f"{condition}.json"

    def transcript_txt(self, condition: str) -> Path:
        return self.transcripts / f"{condition}.txt"

    @property
    def eval(self) -> Path:
        return self.root / "eval"

    def window(self, index: int) -> Path:
        return self.eval / f"window-{index}"

    @property
    def report(self) -> Path:
        return self.root / "report.md"

    def load_bias(self) -> BiasTerms:
        if self.bias.exists():
            return BiasTerms.from_dict(read_json(self.bias))
        return BiasTerms(pages=[], global_terms=[])

    def load_events(self) -> list[Event]:
        return read_events(self.events)

    def load_recording(self) -> Optional[RecordingMeta]:
        if self.recording.exists():
            return RecordingMeta.from_dict(read_json(self.recording))
        return None

    def load_transcript(self, condition: str) -> Optional[Transcript]:
        p = self.transcript_json(condition)
        if p.exists():
            return Transcript.from_dict(read_json(p))
        return None
