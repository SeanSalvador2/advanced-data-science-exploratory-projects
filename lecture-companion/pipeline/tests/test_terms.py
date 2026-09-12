"""Heuristic term extraction from deck text (no PDF, no network)."""

from __future__ import annotations

from collections import Counter

import pytest

from lecture_rec.schemas import MAX_GLOBAL_TERMS, MAX_PAGE_TERMS
from lecture_rec.terms import (
    candidates_from_text,
    extract_bias_terms,
    rank_terms,
    rarity,
    write_deck_txt,
)

PAGE = """\
Optimal Transport and the Wasserstein Distance
We compare the KL-divergence with the Sinkhorn algorithm.
Let theta be the parameter and let lambda control entropy.
The Lipschitz constant is bounded; see Kantorovich duality.
Recall backPropagation and the L2 norm.
"""


def terms_of(text):
    return {t.lower() for t in candidates_from_text(text)}


def test_capitalised_multiword_phrases_are_found():
    got = terms_of(PAGE)
    assert "wasserstein distance" in got or "optimal transport" in got


def test_hyphenated_tokens_are_found():
    assert "kl-divergence" in terms_of(PAGE)


def test_camel_case_tokens_are_found():
    assert "backpropagation" in terms_of(PAGE)


def test_digit_containing_tokens_are_found():
    assert "l2" in terms_of("Recall the L2 norm and the R2 score.")


def test_rare_single_words_are_found():
    got = terms_of(PAGE)
    assert "sinkhorn" in got
    assert "kantorovich" in got


def test_common_words_are_not_terms():
    got = terms_of("The next slide shows that we can do this today.")
    assert "next" not in got and "today" not in got and "shows" not in got


def test_greek_letters_spelled_out():
    got = terms_of(PAGE)
    assert "theta" in got and "lambda" in got


def test_greek_symbols_become_their_spelling():
    got = terms_of("Minimise over θ with step size α and rate λ.")
    assert "theta" in got and "alpha" in got and "lambda" in got


def test_dedupe_is_case_insensitive():
    ranked = rank_terms(["Wasserstein", "wasserstein", "WASSERSTEIN"], Counter(), 40)
    assert len(ranked) == 1
    assert ranked[0] == "Wasserstein"           # the capitalised spelling wins


def test_rarer_terms_rank_first():
    ranked = rank_terms(["Kantorovich", "problem"], Counter(), 40)
    assert ranked[0] == "Kantorovich"


def test_rarity_of_a_phrase_is_its_rarest_word():
    assert rarity("Wasserstein distance") == pytest.approx(rarity("Wasserstein"))


def test_frequency_breaks_rarity_ties():
    # Two equally unknown (equally rare) tokens: the deck frequency decides.
    counts = Counter({"zzqqfoo": 1, "zzqqbar": 9})
    ranked = rank_terms(["zzqqfoo", "zzqqbar"], counts, 40)
    assert ranked[0] == "zzqqbar"


def test_extract_bias_terms_shape_and_caps():
    pages = [PAGE, "The Fokker-Planck equation and the Metropolis Hastings sampler."]
    bias = extract_bias_terms(pages)
    assert bias.source == "heuristic"
    assert bias.deck == "deck.pdf"
    assert [p.page for p in bias.pages] == [1, 2]
    assert all(len(p.terms) <= MAX_PAGE_TERMS for p in bias.pages)
    assert len(bias.global_terms) <= MAX_GLOBAL_TERMS
    page2 = {t.lower() for t in bias.pages[1].terms}
    assert "fokker-planck" in page2
    assert bias.pages[0].terms != bias.pages[1].terms


def test_extract_bias_terms_caps_a_huge_page():
    huge = " ".join(f"Xyzzy{i}quux" for i in range(500))
    bias = extract_bias_terms([huge])
    assert len(bias.pages[0].terms) <= MAX_PAGE_TERMS
    assert len(bias.to_dict()["pages"][0]["terms"]) <= MAX_PAGE_TERMS


def test_empty_page_yields_no_terms():
    bias = extract_bias_terms(["", "   "])
    assert bias.pages[0].terms == []
    assert bias.global_terms == []


def test_write_deck_txt_is_page_separated(tmp_path):
    p = tmp_path / "deck.txt"
    write_deck_txt(p, ["first page", "second page"])
    text = p.read_text()
    assert "=== page 1 ===" in text and "=== page 2 ===" in text
    assert text.index("first page") < text.index("=== page 2 ===")
