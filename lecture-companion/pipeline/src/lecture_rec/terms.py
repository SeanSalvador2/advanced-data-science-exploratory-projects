"""Heuristic vocabulary-bias extraction from a slide deck.

`lecture-rec terms` writes bias.json (source "heuristic") and deck.txt. The
`/lecture-bias-terms` Claude Code skill writes the same bias.json with source
"claude" and usually does a better job; this module is the no-Claude fallback
and the thing that guarantees a bias.json exists on lecture day.
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path
from typing import Iterable, Optional

from .schemas import (
    MAX_GLOBAL_TERMS,
    MAX_PAGE_TERMS,
    BiasTerms,
    LectureDir,
    PageTerms,
    write_json,
)

# A single word is "interesting" below this zipf frequency (per the brief).
SINGLE_WORD_ZIPF = 3.8
# A capitalised phrase is kept if its rarest word is below this.
PHRASE_ZIPF = 4.6
MIN_WORD_LEN = 4

GREEK_NAMES = [
    "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta",
    "iota", "kappa", "lambda", "mu", "nu", "xi", "omicron", "pi", "rho",
    "sigma", "tau", "upsilon", "phi", "chi", "psi", "omega",
]
GREEK_SYMBOLS = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
    "ζ": "zeta", "η": "eta", "θ": "theta", "ι": "iota", "κ": "kappa",
    "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "ο": "omicron",
    "π": "pi", "ρ": "rho", "σ": "sigma", "τ": "tau", "υ": "upsilon",
    "φ": "phi", "χ": "chi", "ψ": "psi", "ω": "omega",
    "Γ": "Gamma", "Δ": "Delta", "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi",
    "Π": "Pi", "Σ": "Sigma", "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
}

# Words that must never start (or be) a bias term: sentence-initial capitals
# and slide furniture produce a lot of these.
STOP = {
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "for", "to",
    "of", "in", "on", "at", "by", "with", "from", "as", "is", "are", "was",
    "were", "be", "been", "this", "that", "these", "those", "we", "you", "it",
    "its", "our", "your", "their", "his", "her", "they", "he", "she", "not",
    "no", "yes", "can", "will", "would", "should", "could", "may", "might",
    "must", "have", "has", "had", "do", "does", "did", "so", "than", "there",
    "here", "what", "when", "where", "which", "who", "why", "how", "all",
    "any", "each", "more", "most", "some", "such", "only", "own", "same",
    "next", "slide", "lecture", "chapter", "figure", "table", "example",
    "outline", "overview", "summary", "introduction", "agenda", "questions",
    "university", "today", "week", "page",
}

_WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
_CAP_PHRASE = re.compile(r"\b([A-Z][A-Za-z]+(?:[ \t]+[A-Z][A-Za-z]+)+)\b")
_HYPHENATED = re.compile(r"\b([A-Za-z]{2,}(?:-[A-Za-z0-9]{2,})+)\b")
_CAMEL = re.compile(r"\b([a-z]+[A-Z][A-Za-z]*)\b")
_WITH_DIGIT = re.compile(r"\b([A-Za-z]+[0-9]+[A-Za-z0-9]*|[0-9]+[A-Za-z]{2,})\b")
_ACRONYM = re.compile(r"\b([A-Z]{2,6})\b")
_TOKEN_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9'’\- ]*$")


def _zipf(word: str) -> float:
    try:
        from wordfreq import zipf_frequency
    except Exception:                                   # pragma: no cover
        return 0.0
    return float(zipf_frequency(word.lower(), "en"))


def rarity(term: str) -> float:
    """Higher = rarer. A phrase is as rare as its rarest word."""
    words = [w for w in _WORD.findall(term) if len(w) >= 3]
    if not words:
        return 8.0
    return 8.0 - min(_zipf(w) for w in words)


def _clean_phrase(phrase: str) -> Optional[str]:
    words = phrase.split()
    while words and words[0].lower() in STOP:
        words.pop(0)
    while words and words[-1].lower() in STOP:
        words.pop()
    if len(words) < 2:
        return None
    return " ".join(words)


def candidates_from_text(text: str) -> list[str]:
    """Every candidate bias term in one page of deck text (with duplicates)."""
    out: list[str] = []

    for m in _CAP_PHRASE.finditer(text):
        phrase = _clean_phrase(m.group(1))
        if phrase and min((_zipf(w) for w in phrase.split()), default=0.0) < PHRASE_ZIPF:
            out.append(phrase)

    for rx in (_HYPHENATED, _CAMEL, _WITH_DIGIT, _ACRONYM):
        for m in rx.finditer(text):
            tok = m.group(1)
            if tok.lower() not in STOP and len(tok) >= 2:
                out.append(tok)

    for sym, name in GREEK_SYMBOLS.items():
        if sym in text:
            out.append(name)
    lowered = text.lower()
    for name in GREEK_NAMES:
        if re.search(rf"\b{name}\b", lowered):
            out.append(name)

    for m in _WORD.finditer(text):
        w = m.group(0)
        if len(w) >= MIN_WORD_LEN and w.lower() not in STOP and w.isalpha():
            if _zipf(w) < SINGLE_WORD_ZIPF:
                out.append(w)

    return [t for t in out if _TOKEN_OK.match(t)]


def rank_terms(candidates: Iterable[str], deck_counts: Counter, limit: int) -> list[str]:
    """Dedupe case-insensitively, then rank by (rarity, frequency in deck)."""
    best: dict[str, str] = {}
    local = Counter()
    for term in candidates:
        key = term.lower()
        local[key] += 1
        # Prefer the capitalised spelling if we ever see one.
        if key not in best or (term[:1].isupper() and not best[key][:1].isupper()):
            best[key] = term
    scored = [
        (rarity(best[k]), deck_counts.get(k, local[k]), best[k])
        for k in best
    ]
    scored.sort(key=lambda x: (-x[0], -x[1], x[2].lower()))
    return [t for _, _, t in scored[:limit]]


def read_deck_pages(pdf_path: str | Path) -> list[str]:
    """Text of each page, 1-based order. Requires pypdf, no external binary."""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:                                # pragma: no cover
            pages.append("")
    return pages


def extract_bias_terms(pages_text: list[str], deck_name: str = "deck.pdf") -> BiasTerms:
    per_page_candidates = [candidates_from_text(t) for t in pages_text]

    deck_counts: Counter = Counter()
    for cands in per_page_candidates:
        for term in set(c.lower() for c in cands):
            deck_counts[term] += 1
    for cands in per_page_candidates:
        for c in cands:
            deck_counts[c.lower()] += 0     # ensure key exists

    pages = [
        PageTerms(page=i + 1, terms=rank_terms(cands, deck_counts, MAX_PAGE_TERMS))
        for i, cands in enumerate(per_page_candidates)
    ]
    all_candidates = [c for cands in per_page_candidates for c in cands]
    global_terms = rank_terms(all_candidates, deck_counts, MAX_GLOBAL_TERMS)
    return BiasTerms(deck=deck_name, source="heuristic", pages=pages,
                     global_terms=global_terms)


def build_prompt(terms: list[str], max_words: int = 60) -> str:
    """Terms joined by ', ', truncated to at most `max_words` words.

    Whisper's prompt window is ~223 tokens; 60 words keeps us well under it and
    leaves the decoder room to actually decode.
    """
    kept: list[str] = []
    used = 0
    for term in terms:
        n = len(term.split())
        if n == 0:
            continue
        if used + n > max_words:
            continue
        kept.append(term)
        used += n
        if used >= max_words:
            break
    return ", ".join(kept)


def write_deck_txt(path: str | Path, pages_text: list[str]) -> None:
    """Page-separated plain text, so the Claude skill can read the deck cheaply."""
    chunks = [f"=== page {i + 1} ===\n{t.strip()}\n" for i, t in enumerate(pages_text)]
    Path(path).write_text("\n".join(chunks), encoding="utf-8")


def run_terms(dir_path: str | Path, deck: Optional[str] = None) -> BiasTerms:
    ld = LectureDir(dir_path)
    ld.root.mkdir(parents=True, exist_ok=True)

    if deck:
        src = Path(deck)
        if not src.exists():
            raise SystemExit(f"deck not found: {src}")
        if src.resolve() != ld.deck.resolve():
            ld.deck.write_bytes(src.read_bytes())
    if not ld.deck.exists():
        raise SystemExit(
            f"no deck at {ld.deck}. Pass --deck path/to/slides.pdf the first time."
        )

    pages_text = read_deck_pages(ld.deck)
    write_deck_txt(ld.deck_txt, pages_text)
    bias = extract_bias_terms(pages_text, deck_name="deck.pdf")
    write_json(ld.bias, bias.to_dict())

    print(f"deck: {ld.deck}  ({len(pages_text)} pages)")
    print(f"wrote {ld.deck_txt}")
    print(f"wrote {ld.bias}  (source=heuristic)")
    print()
    print(f"{'page':>5}  {'#terms':>6}  top terms")
    print("-" * 72)
    for p in bias.pages:
        preview = ", ".join(p.terms[:6])
        if len(preview) > 56:
            preview = preview[:53] + "..."
        print(f"{p.page:>5}  {len(p.terms):>6}  {preview}")
    print("-" * 72)
    print(f"global ({len(bias.global_terms)}): {', '.join(bias.global_terms[:12])}")
    if not bias.global_terms:
        print("WARNING: no terms found. Is the PDF a scan (no text layer)?")
    print()
    print("Tip: for much better terms, run  /lecture-bias-terms " f"{ld.root}"
          "  inside Claude Code.")
    return bias
