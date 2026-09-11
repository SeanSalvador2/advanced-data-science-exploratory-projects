"""Score normalization, term recall, pooling and the verdict thresholds."""

from __future__ import annotations

import math

import pytest

from spike.evalwin import (
    EvalWindowMeta,
    expected_terms,
    normalize_text,
    pool,
    score_window,
    segments_in_span,
    snap_window,
    term_present,
    window_fractions,
)
from spike.report import (
    HELPS,
    HURTS,
    NO_EFFECT,
    PROCEED,
    RETEST,
    STOP,
    bias_effect,
    verdict,
)
from spike.schemas import BiasTerms, PageTerms, Segment


# --------------------------------------------------------------------------- #
# normalization
# --------------------------------------------------------------------------- #


def test_normalize_lowercases_and_strips_punctuation():
    assert normalize_text("The Wasserstein Distance, again!") == \
        "the wasserstein distance again"


def test_normalize_collapses_whitespace():
    assert normalize_text("  a\n b   c\t\n") == "a b c"


def test_normalize_expands_contractions():
    out = normalize_text("It's what we've got, don't worry")
    assert "it is" in out
    assert "'" not in out


def test_normalize_leaves_numbers_alone():
    assert normalize_text("Take 3 steps, then 42.") == "take 3 steps then 42"


def test_normalize_is_identical_for_both_sides():
    ref = "It's the KL-divergence, again."
    hyp = "it's the kl-divergence again"
    assert normalize_text(ref) == normalize_text(hyp)


def test_normalize_empty():
    assert normalize_text("") == ""
    assert normalize_text("   ") == ""


# --------------------------------------------------------------------------- #
# term matching
# --------------------------------------------------------------------------- #


def test_term_present_case_insensitive():
    text = normalize_text("we then take the Wasserstein distance")
    assert term_present("wasserstein", text)
    assert term_present("Wasserstein", text)


def test_term_present_multiword():
    text = normalize_text("the KL divergence between them")
    assert term_present("KL divergence", text)
    assert not term_present("JS divergence", text)


def test_term_present_is_hyphen_and_space_insensitive():
    assert term_present("back-propagation", normalize_text("backpropagation again"))
    assert term_present("backpropagation", normalize_text("back-propagation again"))
    assert term_present("KL-divergence", normalize_text("the kl divergence"))


def test_short_term_does_not_match_inside_a_longer_word():
    text = normalize_text("we set theta to zero")
    assert not term_present("eta", text)
    assert term_present("theta", text)


def test_term_absent():
    assert not term_present("Lipschitz", normalize_text("nothing like it here"))
    assert not term_present("", normalize_text("anything"))


def test_expected_terms_is_global_union_slide_pages():
    bias = BiasTerms(
        pages=[PageTerms(1, ["Wasserstein"]), PageTerms(2, ["Lipschitz"]),
               PageTerms(3, ["Frobenius"])],
        global_terms=["argmax"],
    )
    assert set(expected_terms(bias, [1, 2])) == {"argmax", "Wasserstein", "Lipschitz"}
    assert set(expected_terms(bias, [])) == {"argmax"}


def test_expected_terms_dedupes_case_insensitively():
    bias = BiasTerms(pages=[PageTerms(1, ["argmax", "ArgMax"])], global_terms=["Argmax"])
    assert len(expected_terms(bias, [1])) == 1


# --------------------------------------------------------------------------- #
# window scoring
# --------------------------------------------------------------------------- #


BIAS = BiasTerms(
    pages=[PageTerms(1, ["Wasserstein", "Lipschitz", "Frobenius"])],
    global_terms=["argmax"],
)
META = EvalWindowMeta(index=1, start=0.0, end=300.0, slides=[1])


def test_perfect_transcript_scores_zero_wer_and_full_recall():
    ref = "the Wasserstein distance is Lipschitz and we take the argmax"
    s = score_window(META, ref, ref, "plain", BIAS)
    assert s.wer == 0.0
    assert s.recall == 1.0
    assert s.terms_expected == 3        # Frobenius is not in the reference
    assert s.terms_found == 3
    assert s.missed_terms == []


def test_wer_counts_substitutions_insertions_deletions():
    ref = "one two three four five"
    assert score_window(META, ref, "one two three four five", "plain", BIAS).wer == 0.0
    assert score_window(META, ref, "one two THREE_X four five", "plain", BIAS).wer == \
        pytest.approx(0.2)
    assert score_window(META, ref, "one two four five", "plain", BIAS).wer == \
        pytest.approx(0.2)
    assert score_window(META, ref, "one two three four five six", "plain", BIAS).wer == \
        pytest.approx(0.2)


def test_recall_only_counts_terms_actually_in_the_reference():
    ref = "the Wasserstein distance and the argmax"
    hyp = "the Vasser Stein distance and the argmax"
    s = score_window(META, ref, hyp, "plain", BIAS)
    assert s.terms_expected == 2
    assert s.terms_found == 1
    assert s.missed_terms == ["Wasserstein"]
    assert s.recall == pytest.approx(0.5)


def test_recall_is_nan_when_the_reference_has_no_bias_terms():
    s = score_window(META, "just some plain words", "just some plain words",
                     "plain", BIAS)
    assert s.terms_expected == 0
    assert math.isnan(s.recall)


def test_pooling_weights_by_reference_length():
    long_ref = " ".join(["word"] * 100)
    short_ref = "alpha beta"
    a = score_window(EvalWindowMeta(1, 0, 10, []), long_ref, long_ref, "plain", BIAS)
    b = score_window(EvalWindowMeta(2, 10, 20, []), short_ref, "gamma delta",
                     "plain", BIAS)
    p = pool([a, b], "plain")
    assert p.windows == 2
    # 2 errors out of 102 reference words, not the mean of 0% and 100%.
    assert p.wer == pytest.approx(2 / 102, rel=1e-6)


def test_pool_of_nothing_is_nan():
    p = pool([], "biased")
    assert math.isnan(p.wer) and p.windows == 0


# --------------------------------------------------------------------------- #
# window selection
# --------------------------------------------------------------------------- #


def test_window_fractions():
    assert window_fractions(3) == pytest.approx([0.2, 0.5, 0.8])
    assert window_fractions(1) == [0.5]
    assert window_fractions(2) == pytest.approx([0.2, 0.8])
    assert len(window_fractions(5)) == 5


def test_snap_window_grows_to_piece_boundaries():
    segs = [Segment(i, 1, i * 28.0, (i + 1) * 28.0, "", f"seg{i}") for i in range(20)]
    start, end, chosen = snap_window(segs, center=140.0, window_s=60.0)
    assert start in [s.start for s in segs]
    assert end in [s.end for s in segs]
    assert end - start >= 60.0 - 28.0
    assert chosen[0].start == start and chosen[-1].end == end


def test_segments_in_span_uses_overlap_not_containment():
    segs = [Segment(0, 1, 0.0, 28.0, "", "a"), Segment(1, 1, 28.0, 56.0, "", "b")]
    assert [s.id for s in segments_in_span(segs, 27.0, 29.0)] == [0, 1]
    assert [s.id for s in segments_in_span(segs, 28.0, 40.0)] == [1]


# --------------------------------------------------------------------------- #
# verdict thresholds
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("wer,recall,expected", [
    (5.0, 95.0, PROCEED),
    (14.9, 85.0, PROCEED),
    (15.0, 95.0, RETEST),        # WER exactly 15 is no longer "proceed"
    (14.0, 84.9, RETEST),        # good WER, vocabulary still dropping out
    (29.9, 99.0, RETEST),
    (30.1, 99.0, STOP),
    (10.0, 59.9, STOP),
    (50.0, 20.0, STOP),
    (float("nan"), float("nan"), STOP),
])
def test_verdict_thresholds(wer, recall, expected):
    assert verdict(wer, recall) == expected


@pytest.mark.parametrize("delta,expected", [
    (12.0, HELPS), (5.0, HELPS), (4.9, NO_EFFECT), (0.0, NO_EFFECT),
    (-4.9, NO_EFFECT), (-5.0, HURTS), (-30.0, HURTS),
])
def test_bias_effect_thresholds(delta, expected):
    assert bias_effect(delta) == expected
