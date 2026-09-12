"""Turn window scores into report.md and a one-line go/no-go verdict."""

from __future__ import annotations

import math
from typing import Optional, Sequence

from .schemas import LectureDir, Transcript, fmt_mmss, now_iso

PROCEED = "PROCEED"
RETEST = "PROCEED ONLY AFTER RE-TEST WITH BETTER MIC"
STOP = "STOP: audio path not viable with this setup"

VERDICT_MEANING = {
    PROCEED: (
        "The transcript is accurate enough and the technical vocabulary survives. "
        "Build the rest of the lecture companion on this audio path."
    ),
    RETEST: (
        "Usable but not comfortable. Move the mic closer (a $30 lavalier or sitting "
        "in the front row usually fixes it), re-record one lecture, and re-run the "
        "measurement before building anything on top."
    ),
    STOP: (
        "Too many words are wrong for downstream summarising or search to be "
        "trustworthy. Change the capture (dedicated recorder, closer mic, or the "
        "lecturer's own audio feed) before spending more time here."
    ),
}

HELPS = "biasing helps, keep it"
NO_EFFECT = "no measurable effect"
HURTS = "biasing hurts; investigate prompt echo"


def verdict(wer_pct: float, recall_pct: float) -> str:
    """The three thresholds from the Phase 0 plan, evaluated worst-case first."""
    if math.isnan(wer_pct):
        return STOP
    if wer_pct > 30.0 or (not math.isnan(recall_pct) and recall_pct < 60.0):
        return STOP
    if wer_pct < 15.0 and not math.isnan(recall_pct) and recall_pct >= 85.0:
        return PROCEED
    return RETEST


def bias_effect(delta_recall_points: float) -> str:
    if math.isnan(delta_recall_points):
        return NO_EFFECT
    if delta_recall_points >= 5.0:
        return HELPS
    if delta_recall_points <= -5.0:
        return HURTS
    return NO_EFFECT


def _pct(x: float) -> str:
    return "n/a" if (x is None or math.isnan(x)) else f"{100.0 * x:.1f}"


def _signed(x: float) -> str:
    return "n/a" if (x is None or math.isnan(x)) else f"{x:+.1f}"


def build_report(
    ld: LectureDir,
    scores: Sequence,
    pooled: dict,
    unedited: Sequence[int],
    transcripts: Optional[dict[str, Transcript]] = None,
) -> str:
    transcripts = transcripts or {}
    lines: list[str] = []
    a = lines.append

    a(f"# Transcription quality report - {ld.root.name}")
    a("")
    a(f"Generated {now_iso()}")
    for cond, tr in sorted(transcripts.items()):
        a(f"- **{cond}**: engine `{tr.engine}`, model `{tr.model}`, "
          f"{len(tr.segments)} segments")
    a("")

    if unedited:
        a(f"> **Warning:** reference.txt in window(s) {', '.join(map(str, unedited))} "
          "is still byte-identical to draft.txt. Those windows are scoring the "
          "transcript against itself, so their numbers are meaningless. Hand-correct "
          "them while listening to clip.wav, then re-run `lecture-rec score`.")
        a("")

    # ---- per-window table -------------------------------------------------- #
    a("## Per-window results")
    a("")
    a("| window | span | condition | WER % | term recall % | terms in ref | terms found |")
    a("|---|---|---|---|---|---|---|")
    for s in sorted(scores, key=lambda s: (s.index, s.condition)):
        a(
            f"| {s.index} | {fmt_mmss(s.start)}-{fmt_mmss(s.end)} | {s.condition} "
            f"| {_pct(s.wer)} | {_pct(s.recall)} | {s.terms_expected} "
            f"| {s.terms_found} |"
        )
    a("")

    # ---- pooled ------------------------------------------------------------ #
    a("## Pooled")
    a("")
    a("| condition | windows | WER % | term recall % | terms in ref | terms found |")
    a("|---|---|---|---|---|---|")
    for cond in sorted(pooled):
        p = pooled[cond]
        a(
            f"| {cond} | {p.windows} | {_pct(p.wer)} | {_pct(p.recall)} "
            f"| {p.terms_expected} | {p.terms_found} |"
        )
    a("")

    plain = pooled.get("plain")
    biased = pooled.get("biased")
    d_wer = d_recall = float("nan")
    if plain and biased:
        d_wer = 100.0 * (biased.wer - plain.wer)
        d_recall = 100.0 * (biased.recall - plain.recall)
        a(f"**Delta (biased - plain):** WER {_signed(d_wer)} points, "
          f"term recall {_signed(d_recall)} points")
        a("")

    # ---- missed terms ------------------------------------------------------ #
    missed_rows = [s for s in scores if s.missed_terms]
    if missed_rows:
        a("## Terms the reference contains but the transcript missed")
        a("")
        for s in sorted(missed_rows, key=lambda s: (s.index, s.condition)):
            a(f"- window {s.index} / {s.condition}: {', '.join(s.missed_terms[:25])}")
        a("")

    # ---- verdict ----------------------------------------------------------- #
    driver = biased if biased and biased.windows else plain
    driver_name = "biased" if driver is biased else "plain"
    if driver is None:
        wer_pct, recall_pct = float("nan"), float("nan")
    else:
        wer_pct = 100.0 * driver.wer
        recall_pct = 100.0 * driver.recall

    v = verdict(wer_pct, recall_pct)

    a("## Verdict")
    a("")
    a(f"Judged on the **{driver_name}** condition: pooled WER "
      f"{_pct(driver.wer) if driver else 'n/a'}%, term recall "
      f"{_pct(driver.recall) if driver else 'n/a'}%.")
    if driver_name == "plain" and biased is None:
        a("")
        a("(No biased transcript was produced, so the verdict uses the plain one.)")
    a("")
    a(f"### {v}")
    a("")
    a(VERDICT_MEANING[v])
    a("")
    a("Thresholds: PROCEED needs WER < 15% and term recall >= 85%. "
      "WER 15-30% (or recall 60-85%) means re-test with a better mic. "
      "WER > 30% or recall < 60% means stop.")
    a("")

    a("### Did the vocabulary biasing help?")
    a("")
    if plain and biased:
        a(f"**{bias_effect(d_recall)}** (term recall {_signed(d_recall)} points, "
          f"WER {_signed(d_wer)} points).")
        if bias_effect(d_recall) == HURTS:
            a("")
            a("Check transcripts/biased.txt for segments that begin with a run of "
              "comma-separated terms: that is the prompt leaking into the output. "
              "Shorten the prompt or drop the biased condition.")
    else:
        a("Only one condition was transcribed, so there is nothing to compare.")
    a("")

    if unedited:
        a("_Numbers above are provisional until every reference.txt is hand-corrected._")
        a("")

    return "\n".join(lines)
