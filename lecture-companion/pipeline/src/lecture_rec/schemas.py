"""Dataclasses + JSON (de)serialization for every on-disk contract.

Every file the CLI writes into a lecture directory has its shape defined here.
Nothing else in the package should build these dicts by hand.

The JSON spellings are the TypeScript contracts in
`lecture-companion/packages/core/src/schemas/` (architecture.md sections 4.4 to
4.6): camelCase keys, and a `schema` string on every whole-file JSON object.
`lecture validate <file>` in the Node CLI is the cross-language oracle.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Literal, Optional

EventType = Literal["start", "slide", "note", "stop"]
EventSource = Literal["app", "recorder"]
Condition = Literal["plain", "biased"]

RECORDING_SCHEMA = "recording/1"
TRANSCRIPT_SCHEMA = "transcript/1"
BIAS_SCHEMA = "bias/1"

#: One event must fit in a single small write so that two processes appending
#: to `events.jsonl` can never interleave halves of a line.
MAX_EVENT_LINE_BYTES = 4096

# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #


def now_iso() -> str:
    """Local time, ISO-8601 with milliseconds and a UTC offset.

    Milliseconds because `startedWall` is the origin the app's wall-clock-only
    events are projected onto; a whole second of rounding there would move
    every slide marker by up to a second.
    """
    return datetime.now().astimezone().isoformat(timespec="milliseconds")


def parse_iso(text: str) -> datetime:
    """Parse an ISO-8601 timestamp; a trailing `Z` is accepted."""
    s = str(text).strip()
    if s.endswith("Z") or s.endswith("z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)


def iso_delta_s(later: str, earlier: str) -> float:
    """Seconds from `earlier` to `later`, both ISO-8601 (offsets respected)."""
    return (parse_iso(later) - parse_iso(earlier)).total_seconds()


def _drop_none(d: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def read_json(path: Path) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def tmp_path_for(path: str | Path) -> Path:
    """The temp name `write_json` writes through: hidden, same directory.

    Same directory so that `os.replace` is an atomic rename within one
    filesystem; hidden and pid-tagged so a reader globbing the lecture folder
    never picks it up and two processes never collide.
    """
    p = Path(path)
    return p.with_name(f".{p.name}.{os.getpid()}.tmp")


def write_json(path: Path, payload: Any) -> None:
    """Write JSON so that a concurrent reader sees either the old file or the
    new one, never a half-written one."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = tmp_path_for(p)
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, p)


# --------------------------------------------------------------------------- #
# Event  (events.jsonl, one per line)
# --------------------------------------------------------------------------- #


@dataclass
class Event:
    """One line of `events.jsonl` (architecture.md section 4.4).

    `t` is seconds on the audio clock. It is absent on events written by the
    browser app, which knows only the wall clock; `transcribe` projects those
    onto the audio clock before anything else looks at them.
    """

    wall: str                     # ISO-8601 local time with offset, always present
    type: EventType
    t: Optional[float] = None     # seconds since audio frame 0 (the audio clock)
    slide: Optional[int] = None   # 1-based, present for type == "slide"
    text: Optional[str] = None    # present for type == "note"
    source: Optional[EventSource] = None

    def to_dict(self) -> dict[str, Any]:
        return _drop_none(
            {"t": None if self.t is None else float(self.t),
             "wall": self.wall, "type": self.type,
             "slide": self.slide, "text": self.text, "source": self.source}
        )

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Event":
        return cls(
            wall=d["wall"],
            type=d["type"],
            t=None if d.get("t") is None else float(d["t"]),
            slide=int(d["slide"]) if d.get("slide") is not None else None,
            text=d.get("text"),
            source=d.get("source"),
        )


def event_line(ev: Event) -> str:
    """One JSON line, truncated so it stays under `MAX_EVENT_LINE_BYTES`."""
    line = json.dumps(ev.to_dict(), ensure_ascii=False) + "\n"
    while len(line.encode("utf-8")) > MAX_EVENT_LINE_BYTES:
        text = ev.text or ""
        if not text:
            raise ValueError("event line too long and nothing left to truncate")
        ev = Event(wall=ev.wall, type=ev.type, t=ev.t, slide=ev.slide,
                   text=text[: max(0, len(text) - 64)], source=ev.source)
        line = json.dumps(ev.to_dict(), ensure_ascii=False) + "\n"
    return line


def append_event(path: Path, ev: Event) -> None:
    """Append one event as a single `O_APPEND` write.

    The browser app appends slide and note events to the same file while the
    recorder is running. One `write()` of one short line on a file opened with
    `O_APPEND` is what keeps the two writers from interleaving half-lines.
    """
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    data = event_line(ev).encode("utf-8")
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        os.write(fd, data)
    finally:
        os.close(fd)


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
            fh.write(event_line(ev))


# --------------------------------------------------------------------------- #
# RecordingMeta  (recording.json)
# --------------------------------------------------------------------------- #


@dataclass
class RecordingMeta:
    """`recording.json` (architecture.md section 4.5).

    Written camelCase with `schema`, exactly as `RecordingMetaSchema` in
    `packages/core` requires. `from_dict` also reads the Phase 0 snake_case
    spelling (`started_wall`, `samplerate`, `duration_s`) so lectures recorded
    recorded with the Phase 0 recorder still transcribe.
    """

    started_wall: str
    stopped_wall: Optional[str] = None
    duration_s: Optional[float] = None
    sample_rate: int = 16000
    channels: int = 1
    device: Optional[str] = None
    file: str = "audio.wav"

    def to_dict(self) -> dict[str, Any]:
        return _drop_none(
            {
                "schema": RECORDING_SCHEMA,
                "startedWall": self.started_wall,
                "stoppedWall": self.stopped_wall,
                "durationS": None if self.duration_s is None else float(self.duration_s),
                "sampleRate": int(self.sample_rate),
                "channels": int(self.channels),
                "device": self.device or None,
                "file": self.file,
            }
        )

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "RecordingMeta":
        def pick(*keys: str) -> Any:
            for k in keys:
                if d.get(k) is not None:
                    return d[k]
            return None

        duration = pick("durationS", "duration_s")
        return cls(
            started_wall=pick("startedWall", "started_wall"),
            stopped_wall=pick("stoppedWall", "stopped_wall"),
            duration_s=None if duration is None else float(duration),
            sample_rate=int(pick("sampleRate", "samplerate", "sample_rate") or 16000),
            channels=int(pick("channels") or 1),
            device=pick("device"),
            file=pick("file") or "audio.wav",
        )


# --------------------------------------------------------------------------- #
# Heartbeat  (.lecture/heartbeat.json)
# --------------------------------------------------------------------------- #

HEARTBEAT_INTERVAL_S = 2.0


@dataclass
class Heartbeat:
    """`.lecture/heartbeat.json` (architecture.md section 4.5).

    Rewritten every 2 s while recording and deleted on a clean stop, so the app
    can say "rec 3s", "stale" (nothing for 6 s) or "no recorder".
    """

    pid: int
    started_wall: str
    updated_wall: str
    elapsed_s: float
    rms_recent: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "pid": int(self.pid),
            "startedWall": self.started_wall,
            "updatedWall": self.updated_wall,
            "elapsedS": float(self.elapsed_s),
            "rmsRecent": float(self.rms_recent),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Heartbeat":
        return cls(
            pid=int(d["pid"]),
            started_wall=d["startedWall"],
            updated_wall=d["updatedWall"],
            elapsed_s=float(d["elapsedS"]),
            rms_recent=float(d["rmsRecent"]),
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
    # "derived" is what `lecture bias` writes when it re-shapes terms.json.
    source: Literal["heuristic", "claude", "derived"] = "heuristic"
    pages: list[PageTerms] = field(default_factory=list)
    global_terms: list[str] = field(default_factory=list)   # serialized as "global"

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema": BIAS_SCHEMA,
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
            "schema": TRANSCRIPT_SCHEMA,
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
    def dot_lecture(self) -> Path:
        """The app's and recorder's scratch directory inside the lecture folder."""
        return self.root / ".lecture"

    @property
    def heartbeat(self) -> Path:
        return self.dot_lecture / "heartbeat.json"

    @property
    def transcript(self) -> Path:
        """What a production `transcribe` writes: one transcript, one file."""
        return self.root / "transcript.json"

    @property
    def transcript_text(self) -> Path:
        return self.root / "transcript.txt"

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
