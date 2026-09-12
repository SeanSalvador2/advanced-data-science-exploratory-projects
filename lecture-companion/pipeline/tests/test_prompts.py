"""Prompt construction (60-word cap) and prompt-echo stripping."""

from __future__ import annotations

import pytest

from lecture_rec.chunking import Piece
from lecture_rec.schemas import BiasTerms, PageTerms
from lecture_rec.terms import build_prompt
from lecture_rec.transcribe import PROMPT_MAX_WORDS, prompt_for_piece, strip_prompt_echo


# --------------------------------------------------------------------------- #
# build_prompt
# --------------------------------------------------------------------------- #


def test_prompt_joins_with_comma_space():
    assert build_prompt(["KL divergence", "Wasserstein", "argmax"]) == \
        "KL divergence, Wasserstein, argmax"


def test_prompt_truncates_to_sixty_words():
    terms = [f"term{i}" for i in range(200)]
    prompt = build_prompt(terms, 60)
    assert len(prompt.split()) == 60
    assert prompt.split()[0].startswith("term0")


def test_prompt_counts_words_not_terms():
    terms = ["two words"] * 100
    prompt = build_prompt(terms, 60)
    assert len(prompt.split()) == 60
    assert prompt.count(",") == 29          # 30 two-word terms


def test_prompt_never_splits_a_term_across_the_cap():
    # 59 single words then a three-word term: the term must be dropped whole.
    terms = [f"w{i}" for i in range(59)] + ["a b c", "z"]
    prompt = build_prompt(terms, 60)
    assert "a b c" not in prompt
    assert len(prompt.split()) <= 60


def test_prompt_keeps_ranking_order():
    prompt = build_prompt(["first", "second", "third"], 60)
    assert prompt.index("first") < prompt.index("second") < prompt.index("third")


def test_prompt_of_empty_terms_is_empty():
    assert build_prompt([]) == ""


def test_default_cap_is_sixty():
    assert PROMPT_MAX_WORDS == 60
    assert len(build_prompt([f"t{i}" for i in range(500)]).split()) == 60


def test_prompt_for_piece_uses_page_terms_then_global():
    bias = BiasTerms(pages=[PageTerms(4, ["Wasserstein", "KL divergence"])],
                     global_terms=["argmax"])
    assert prompt_for_piece(Piece(0, 4, 0.0, 10.0), bias) == "Wasserstein, KL divergence"
    assert prompt_for_piece(Piece(1, 9, 0.0, 10.0), bias) == "argmax"
    assert prompt_for_piece(Piece(2, None, 0.0, 10.0), bias) == "argmax"


# --------------------------------------------------------------------------- #
# strip_prompt_echo
# --------------------------------------------------------------------------- #


PROMPT = "Wasserstein, KL divergence, theta hat, argmax, Lipschitz, Frobenius, Hessian"


def test_echo_of_the_whole_prompt_is_stripped():
    text = PROMPT + " So today we look at optimal transport."
    cleaned, echo = strip_prompt_echo(text, PROMPT)
    assert cleaned == "So today we look at optimal transport."
    assert echo.startswith("Wasserstein")


def test_echo_of_the_first_six_words_is_stripped():
    text = "Wasserstein, KL divergence, theta hat, argmax, and that is the plan."
    cleaned, echo = strip_prompt_echo(text, PROMPT)
    assert len(echo.split()) == 6
    assert cleaned == "and that is the plan."


def test_five_matching_words_are_left_alone():
    text = "Wasserstein, KL divergence, theta hat, but not argmax."
    cleaned, echo = strip_prompt_echo(text, PROMPT)
    assert echo == ""
    assert cleaned == text


def test_a_single_leading_bias_term_is_not_an_echo():
    text = "Wasserstein distance is the one we care about here."
    cleaned, echo = strip_prompt_echo(text, PROMPT)
    assert echo == ""
    assert cleaned == text


def test_echo_matching_ignores_punctuation_and_case():
    text = "wasserstein kl divergence theta hat argmax lipschitz right so."
    cleaned, echo = strip_prompt_echo(text, PROMPT)
    assert len(echo.split()) == 7
    assert cleaned == "right so."


def test_no_prompt_means_no_stripping():
    assert strip_prompt_echo("anything at all here", "") == ("anything at all here", "")
    assert strip_prompt_echo("", PROMPT) == ("", "")


def test_text_that_is_only_the_echo_becomes_empty():
    cleaned, echo = strip_prompt_echo(PROMPT, PROMPT)
    assert cleaned == ""
    assert echo.split() == PROMPT.split()


def test_leading_separator_is_trimmed_after_stripping():
    text = "Wasserstein, KL divergence, theta hat, argmax, - now the real content"
    cleaned, _ = strip_prompt_echo(text, PROMPT)
    assert cleaned == "now the real content"


@pytest.mark.parametrize("min_words", [3, 6, 8])
def test_min_words_threshold_is_respected(min_words):
    words = PROMPT.split()
    text = " ".join(words[: min_words - 1]) + " tail"
    cleaned, echo = strip_prompt_echo(text, PROMPT, min_words=min_words)
    assert echo == "" and cleaned == text
    text2 = " ".join(words[:min_words]) + " tail"
    _, echo2 = strip_prompt_echo(text2, PROMPT, min_words=min_words)
    assert len(echo2.split()) == min_words
