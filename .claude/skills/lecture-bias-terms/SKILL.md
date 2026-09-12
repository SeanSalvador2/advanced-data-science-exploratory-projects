---
name: lecture-bias-terms
description: "Produce a per-slide vocabulary bias list (bias.json) for lecture transcription from a slide deck PDF. Use when the user runs /lecture-bias-terms <lecture-dir> or asks for transcription bias terms."
---

# Lecture bias terms

Write `<lecture-dir>/bias.json`: the vocabulary that `lecture-rec transcribe` feeds to
Whisper as an `initial_prompt`, so the technical words in a lecture come out
spelled correctly instead of as phonetic mush.

`<lecture-dir>` is the argument the user gave (e.g. `lecture-companion/pipeline/data/lec01`).
If they did not give one, ask.

## 1. Read the deck

- Read `<lecture-dir>/deck.txt` first if it exists. `lecture-rec terms` writes it, it is
  page-separated with `=== page N ===` markers, and it is much cheaper than the PDF.
- Read `<lecture-dir>/deck.pdf` with the **Read** tool, **20 pages per call**
  (`pages: "1-20"`, then `"21-40"`, ...). Do this when there is no `deck.txt`, and
  also for any page whose extracted text looked empty or garbled — those pages are
  images, and only the PDF read will show you what is on them.
- Keep going until you have seen every page. Page numbers in `bias.json` are
  1-based and must match the PDF's page order exactly, because `lecture-rec` maps
  slide-change markers to page numbers.

## 2. Choose the terms

For each page, list the words a transcript of *someone talking over that slide*
would need to get right:

- technical terms and jargon (`Wasserstein`, `heteroskedasticity`, `Sinkhorn`)
- proper names of people, methods, datasets, libraries (`Kullback-Leibler`,
  `ImageNet`, `scikit-learn`)
- acronyms the lecturer says out loud (`ELBO`, `SGVB`, `KL`)
- **notation as it is read aloud**, not as it is printed. This is the part a
  heuristic extractor cannot do:
  - `D_KL(p‖q)` → `KL divergence`
  - `θ̂` → `theta hat`
  - `argmax_φ` → `argmax`, `phi`
  - `∇_w L` → `gradient`, `nabla`, `w`
  - `x ~ N(0, σ²)` → `sigma squared`, `Gaussian`
  - `W₁` → `Wasserstein one`, `W one`

Rules:

- **Prefer the spelling the transcript should contain.** If the slide prints
  `KL-divergence` but the lecturer says "K L divergence", include both spellings.
- Rank most important first: the terms whose misspelling would most damage the
  transcript go at the top. `lecture-rec` truncates the prompt to ~60 words, so order
  matters more than length.
- Drop ordinary English. `introduction`, `summary`, `next slide`, `results` are
  worthless as bias terms and crowd out the real ones.
- Max **40** terms per page. Max **60** in `global`.
- `global` is the deck's most distinctive vocabulary overall — the terms likely to
  recur across many slides, plus the course/lecturer's recurring names. It is the
  fallback prompt for audio that has no slide marker.
- Terms may be multi-word. Use plain ASCII where the transcript would.

## 3. Write bias.json

Exact schema (this is the contract `pipeline/src/lecture_rec/schemas.py` reads):

```json
{
  "deck": "deck.pdf",
  "source": "claude",
  "pages": [
    {"page": 1, "terms": ["...ranked, most important first, max 40..."]}
  ],
  "global": ["...max 60..."]
}
```

- `source` **must** be `"claude"` (that is how the student can tell your list
  apart from the `lecture-rec terms` heuristic fallback).
- Include an entry in `pages` for **every** page, in order, even if its `terms`
  list is empty (a title slide often is).

Short example for a two-page deck:

```json
{
  "deck": "deck.pdf",
  "source": "claude",
  "pages": [
    {"page": 1, "terms": []},
    {"page": 2, "terms": ["KL divergence", "Kullback-Leibler", "Wasserstein",
                          "theta hat", "argmax", "Sinkhorn", "entropy penalty"]}
  ],
  "global": ["KL divergence", "Wasserstein", "Sinkhorn", "theta hat", "argmax"]
}
```

Write it with a heredoc through **Bash** (not the Write tool), so the JSON goes to
disk in one shot:

```bash
cat > <lecture-dir>/bias.json <<'JSON'
{
  "deck": "deck.pdf",
  "source": "claude",
  "pages": [
    {"page": 1, "terms": []}
  ],
  "global": []
}
JSON
python3 -m json.tool <lecture-dir>/bias.json > /dev/null && echo "bias.json is valid JSON"
```

## 4. Report back

Tell the user: how many pages, how many terms per page (a short table), the
`global` list in full, and any page whose text you could not read (those need a
look by eye). Then remind them the next step is:

```
uv run lecture-rec transcribe <lecture-dir>
```
