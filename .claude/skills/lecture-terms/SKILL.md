---
name: lecture-terms
description: "Build the term index (terms.json) for a prepared lecture folder from its slide images and text lines, consistent with prior lectures. Use when the user runs /lecture-terms <lecture-dir> or asks to precompute terms, definitions, or a glossary for a lecture deck."
---

# Lecture terms

Write `<lecture-dir>/terms.json`: for every slide, what is on it, what each
piece of notation means, and how this course uses it. The student highlights a
phrase during class and reads your entry in under ten seconds, so this is the
one step that is allowed to be slow and careful — it happens the night before,
not in the lecture hall.

`<lecture-dir>` is the argument the user gave (e.g. `~/vault/Lectures/TDL/2026-09-15-lec05`).
If they did not give one, ask.

## 1. Preconditions

The folder must already be prepared. Check, in one Bash call:

```bash
ls <lecture-dir>/lecture.json <lecture-dir>/spans.json <lecture-dir>/pages/ | head
```

- `lecture.json`, `spans.json` and `pages/p001.png ...` must all exist. If any
  is missing, stop and tell the user to run
  `lecture prepare <lecture-dir> --deck <deck.pdf> --course <CODE>` first. Do
  not try to read `deck.pdf` yourself: the page images and the line ids come
  from `prepare`, and ids you invent will not match the app.

Run the CLI from the repo root as:

```bash
node lecture-companion/cli/bin/lecture.mjs <cmd>
```

If `lecture-companion/cli/dist` does not exist, build it once first:

```bash
npm --prefix lecture-companion run build
```

## 2. Procedure

Read `lecture.json` and take `deck.pages` as N, and `priorLectures` if present.

Then walk the deck in batches of **8 pages**: 1-8, 9-16, ... up to N. For each
batch `a-b` (with `b = min(a + 7, N)`):

1. **Context.** Get the batch's text inputs:

   ```bash
   node lecture-companion/cli/bin/lecture.mjs terms-context <lecture-dir> --pages a-b
   ```

   It prints JSON: `lectureId`, `course`, `priorGlossary` (id, term, aliases,
   one-line definition from the lectures named in `priorLectures`), and `pages`
   with each page's `lines` (`id`, `text`, and `kind` when the grouper guessed
   one). Those `id`s are the `lineIds` you must use. Empty lines are already
   dropped, so the ids are not contiguous.

2. **Images.** Read each page image of the batch with the **Read** tool, one
   call per image: `<lecture-dir>/pages/p001.png`, `p002.png`, ... (three
   digits, zero padded). Do this for every page in the batch, including pages
   whose lines look empty — those are the pages that are pictures.

3. **Write the partial.** Apply the prompt in section 3 to the batch and write
   the result with a Bash heredoc (not the Write tool), so the JSON lands in
   one shot:

   ```bash
   mkdir -p <lecture-dir>/.lecture/terms.partial
   cat > <lecture-dir>/.lecture/terms.partial/batch-01.json <<'JSON'
   {"pages": [ ... ]}
   JSON
   ```

   Name the files `batch-01.json`, `batch-02.json`, ... in batch order. The
   file holds a `pages` array **and nothing else** — no `schema`, no
   `glossary`, no `lectureId`. Those come from the merge.

4. **Validate immediately**, before starting the next batch:

   ```bash
   node lecture-companion/cli/bin/lecture.mjs merge terms <lecture-dir> --check
   ```

   `--check` validates every partial written so far against the TermPage
   schema, writes nothing, and prints which pages are still missing. Its errors
   name the file and the page, e.g.
   `batch-02.json page 11: terms.3.kind: Invalid option ...`. Fix the batch you
   just wrote before moving on — a broken partial discovered at merge time
   costs a whole re-run. Exit code 1 means something is wrong; do not continue.

**Resumability.** Run `merge terms <lecture-dir> --check` before the first
batch of a run: whatever it lists as already validating is done, and the pages
it reports as "not written yet" are what is left. Skip the batches whose file
exists and validates; you are resuming an interrupted run. Never rewrite a
good partial, and never widen or narrow a batch's page range between runs —
two files covering the same page is an error at merge time.

After the last batch:

```bash
node lecture-companion/cli/bin/lecture.mjs merge terms <lecture-dir>
node lecture-companion/cli/bin/lecture.mjs bias <lecture-dir>
node lecture-companion/cli/bin/lecture.mjs status <lecture-dir>
```

`merge terms` validates every page, refuses duplicates and gaps, builds the
glossary, writes `terms.json` and stamps `lecture.json`. Add `--clean` to
delete the partials once you trust the result; add `--allow-missing` only when
a page genuinely has nothing on it and you have decided to leave it empty.
`bias` derives `bias.json` for the transcriber from what you wrote.

## 3. The prompt

Apply this to every page of the batch. It is the contract; do not improvise a
different shape.

```
You are building the term index for one lecture of a graduate course. The
student will highlight a phrase on a slide during class and read your entry in
under ten seconds. Write for that moment: precise, short, in the course's own
notation.

For each page you are given its rendered image and its text lines with ids.
The image is the truth; the lines are how you address positions. Use the
image to read notation the text layer mangles.

For every page produce:
- title: as printed, or "".
- summary: one sentence saying what this page does in the argument of the
  lecture (sets up, defines, proves, contrasts, gives an example, recaps).
- overlayGroup: if this page is an incremental build of the previous page
  (same title, content is a superset), give it the same group number.
- terms: every term, method, theorem, dataset, person, metric, and every
  piece of notation a student could point at and ask "what is this".
  Include symbols: write the term as it is read aloud ("theta hat", "KL
  divergence", "ell-infinity ball") and put the printed form in aliases.
  For each: definition (at most two sentences, exact), intuition (at most
  two sentences, plain language, why the thing exists or what it buys you),
  inThisCourse (how this course notates or uses it, or "" if nothing
  course-specific), lineIds (the lines on this page where it appears), kind,
  confidence.
- passages: one entry per bullet, sentence, or equation group that says
  something (skip pure titles and decorations). text is verbatim from the
  lines; explanation is at most three sentences unpacking it in plain words,
  with every symbol named.
- asrBias: up to 40 spellings a speech recognizer should prefer while this
  page is shown, ranked by how badly a misspelling would hurt, spoken forms
  first ("Wasserstein", "Lipschitz", "sigma squared").

Consistency rules:
- The prior glossary is provided. Reuse a prior term's id and keep its
  definition consistent. If this lecture redefines or generalizes it, say so
  in inThisCourse and set firstSeen to the prior lecture and page.
- Prefer this course's phrasing over textbook phrasing. If the slide uses a
  nonstandard symbol, say what the standard one would be.
- Do not invent facts the slide does not support. If you are unsure what a
  symbol means from the image and prior context, set confidence low and say
  what it most likely means.
- No filler terms: "introduction", "results", "next steps" are not terms.

Output: JSON only, matching the TermPage schema below, as {"pages": [...]}.
```

### The shape, one page at a time

This is one page of the `pages` array, annotated. The comments are for you —
the file you write is plain JSON with no comments.

```jsonc
{
  "page": 7,                       // 1-based, matches pages/p007.png
  "title": "Randomized smoothing", // as printed; "" when the slide has no title
  "summary": "Introduces the smoothed classifier and why the noise is added at prediction time.",
                                   // exactly one sentence: what this page does in the argument
  // "overlayGroup": 3,            // only when this page is an incremental build of the previous one
  "terms": [
    {
      "id": "t-randomized-smoothing",   // "t-" + kebab-case; reuse the prior glossary's id when it exists
      "term": "randomized smoothing",   // canonical display form, as it is read aloud
      "aliases": ["smoothing", "g(x)"], // other spellings and the printed notation
      "kind": "method",                 // concept | notation | method | theorem | dataset | person | metric | other
      "lineIds": [0, 2, 4],             // line ids from terms-context, this page only
      "definition": "A defense that replaces a classifier with the majority vote of its predictions under Gaussian noise. The vote margin yields a certified radius.",
      "intuition": "Averaging over noise smooths the decision boundary, so a small perturbation cannot flip the vote.",
      "inThisCourse": "Written g(x); the base classifier is f and the noise scale is sigma.",
      "firstSeen": { "lectureId": "2026-09-08-lec04", "page": 11 },
                                        // only when a prior lecture introduced it; omit otherwise
      "confidence": "high"              // high | medium | low
    },
    {
      "id": "t-sigma",
      "term": "sigma",
      "aliases": ["σ", "noise scale"],
      "kind": "notation",
      "lineIds": [2],
      "definition": "The standard deviation of the Gaussian noise added to each input at prediction time.",
      "intuition": "One knob trading accuracy for the size of the guarantee: more noise certifies a bigger radius and predicts worse.",
      "inThisCourse": "Chosen at training time and held fixed at certification time.",
      "confidence": "high"
    }
  ],
  "passages": [
    {
      "lineIds": [2, 3],
      "text": "Noise scale σ² controls the trade-off.",   // verbatim from the lines
      "explanation": "Sigma squared is the variance of the Gaussian noise. Raising it widens the certified radius and lowers clean accuracy, so it is picked once, before training."
    }
  ],
  "asrBias": ["randomized smoothing", "sigma", "Gaussian", "certified radius", "majority vote"]
                                   // ranked, spoken spellings, at most 40
}
```

Field constraints, all enforced by `merge terms`:

- `definition` and `intuition`: **at most two sentences** each. `explanation`:
  **at most three sentences**. Short beats complete; the student is reading
  mid-lecture.
- `inThisCourse`: `""` when nothing is course-specific. Do not pad it.
- `asrBias`: **at most 40** strings per page, ranked, spoken forms first.
  Anything past 40 is dropped with a warning.
- `id`: `t-` followed by kebab-case ASCII (`t-kl-divergence`, `t-ell-infinity-ball`).
  **Reuse the id from `priorGlossary` whenever the term is the same thing**,
  even if this lecture words it differently — ids are how the app links a
  lecture to the one before it.
- `lineIds`: ids from *this page's* `terms-context` output only. An empty array
  is allowed and means "on the page, not on a particular line".
- `page`: every page of the batch appears exactly once, in order, even if its
  `terms` array ends up empty.
- `confidence`: `low` is a real answer. Use it and hedge the definition rather
  than guessing confidently.

## 4. Quality bar and pitfalls

- **The image is the truth for notation.** The text layer fragments formulas
  into single characters and mangles some glyphs. If the lines say `‖x′−x‖∞ ≤ ε`
  and the image shows a subscript infinity, trust the image and write the term
  as it is spoken ("ell-infinity ball").
- **Lines are addresses, not content.** Use `lineIds` to point; use the image to
  decide what is there.
- **No filler.** "Introduction", "Outline", "Results", "Thank you", the course
  code, the lecturer's affiliation: none of these are terms. A title slide with
  nothing but a title has `terms: []`, and that is the right answer.
- **Every page appears in some batch**, even a blank or a section divider. The
  merge refuses a deck with a hole in it.
- **Keep the partials small.** One batch is 8 pages; do not merge two batches
  into one file, and do not restate the prior glossary inside a partial.
- **Never paste the whole `spans.json` into context.** It is megabytes of
  per-character boxes. `terms-context --pages a-b` exists so you read only the
  lines of the batch you are working on.
- **Do not invent cross-lecture history.** `firstSeen` is only for terms that
  really are in `priorGlossary`.
- **Consistency beats novelty.** If lecture 4 called it "the certificate", call
  it that here too and record the new wording in `aliases`.

## 5. Report back

When the merge and the bias step are done, tell the user:

- how many pages were indexed, and the batches you wrote;
- terms per page, as a short table (page, terms, passages);
- the glossary size, and how many entries were reused from prior lectures;
- every page with zero terms, by number, so they can eyeball those slides;
- every term you marked `confidence: "low"`, with the page, so they can correct
  it before the lecture;
- anything the image did not resolve.

Then the next step, on lecture day:

```
lecture-rec record --dir <lecture-dir>
```
