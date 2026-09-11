"""`spike` command line. argparse only - one less dependency to install the
morning of a lecture."""

from __future__ import annotations

import argparse
import sys
from typing import Optional, Sequence

from . import __version__

EPILOG = """\
typical week:
  spike doctor
  spike terms      --dir data/lec01 --deck slides.pdf
  spike record     --dir data/lec01
  spike transcribe --dir data/lec01
  spike sample     --dir data/lec01
  ... hand-correct eval/window-*/reference.txt while listening to clip.wav ...
  spike score      --dir data/lec01
"""


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="spike",
        description="Local lecture recording, transcription and accuracy spike. "
                    "No cloud APIs, no API keys.",
        epilog=EPILOG,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--version", action="version", version=f"spike {__version__}")
    sub = p.add_subparsers(dest="command", metavar="{doctor,record,terms,transcribe,sample,score}")

    d = sub.add_parser("doctor", help="check mic, engines and ffmpeg before lecture day")
    d.add_argument("--seconds", type=float, default=3.0,
                   help="length of the microphone level test (default 3)")

    r = sub.add_parser("record", help="record a lecture with slide-change markers")
    r.add_argument("--dir", required=True, help="lecture directory (created if missing)")
    r.add_argument("--deck", help="slide PDF to copy in as deck.pdf")
    r.add_argument("--device", help="input device name or index (see `spike doctor`)")

    t = sub.add_parser("terms", help="extract per-slide bias vocabulary from the deck")
    t.add_argument("--dir", required=True)
    t.add_argument("--deck", help="slide PDF (copied in as deck.pdf)")

    x = sub.add_parser("transcribe", help="transcribe plain and vocabulary-biased")
    x.add_argument("--dir", required=True)
    x.add_argument("--engine", default="auto",
                   choices=["auto", "faster-whisper", "mlx-whisper", "parakeet"])
    x.add_argument("--model", help="model name or HF repo (engine-specific default)")
    x.add_argument("--conditions", default="plain,biased",
                   help="comma separated: plain,biased (default both)")
    x.add_argument("--max-piece-s", type=float, default=28.0,
                   help="maximum audio piece length in seconds (default 28)")
    x.add_argument("--resume", action="store_true",
                   help="keep pieces already present in the transcript JSON")

    s = sub.add_parser("sample", help="cut evaluation windows to hand-correct")
    s.add_argument("--dir", required=True)
    s.add_argument("--n", type=int, default=3, help="number of windows (default 3)")
    s.add_argument("--window-s", type=float, default=300.0,
                   help="window length in seconds (default 300)")
    s.add_argument("--condition", default="plain", choices=["plain", "biased"],
                   help="which transcript seeds draft.txt (default plain)")

    c = sub.add_parser("score", help="score transcripts against the corrected windows")
    c.add_argument("--dir", required=True)

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if not args.command:
        parser.print_help()
        return 1

    if args.command == "doctor":
        from .doctor import run_doctor
        return run_doctor(args.seconds)

    if args.command == "record":
        from .record import run_record
        run_record(args.dir, deck=args.deck, device=args.device)
        return 0

    if args.command == "terms":
        from .terms import run_terms
        run_terms(args.dir, deck=args.deck)
        return 0

    if args.command == "transcribe":
        from .transcribe import run_transcribe
        conditions = [c.strip() for c in args.conditions.split(",") if c.strip()]
        run_transcribe(
            args.dir,
            engine_name=args.engine,
            model=args.model,
            conditions=conditions,
            max_piece_s=args.max_piece_s,
            resume=args.resume,
        )
        return 0

    if args.command == "sample":
        from .evalwin import run_sample
        run_sample(args.dir, n=args.n, window_s=args.window_s, condition=args.condition)
        return 0

    if args.command == "score":
        from .evalwin import run_score
        run_score(args.dir)
        return 0

    parser.print_help()
    return 1


if __name__ == "__main__":       # pragma: no cover
    sys.exit(main())
