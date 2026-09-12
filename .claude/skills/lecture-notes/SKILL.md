---
name: lecture-notes
description: "Write per-slide, span-anchored lecture notes (notes.json) from a lecture folder's transcript and typed notes, then export Markdown. Use when the user runs /lecture-notes <lecture-dir> or asks to generate notes for a recorded lecture."
---

# Lecture notes

Write `<lecture-dir>/notes.json` and then render `<lecture-dir>/<lecture-id>.md`:
for every slide, the layer of the lecture that is *not* on the slide. The slide
is already a document the student can reread; the transcript is the part that
evaporated. This runs after the lecture, from the recording, so it is allowed to
be slow and careful.

`<lecture-dir>` is the argument the user gave (e.g. `~/vault/Lectures/TDL/2026-09-15-lec05`).
If they did not give one, ask.

## 1. Preconditions

Check, in one Bash call:

```bash
ls <lecture-dir>/lecture.json <lecture-dir>/spans.json <lecture-dir>/transcript.json <lecture-dir>/terms.json
```

- `lecture.json`, `spans.json` and `transcript.json` must all exist.
- **`transcript.json` missing** is the common case and it is not your problem to
  fix: stop and tell the user to run `lecture-rec transcribe <lecture-dir>`
  first. Without it there is nothing to write notes from.
- `spans.json` missing means the folder was never prepared: tell the user to run
  `lecture prepare <lecture-dir> --deck <deck.pdf> --course <CODE>`.
- `terms.json` is **strongly recommended** and not required. It carries the page
  titles, the term ids you attach to notes, and the correct spelling of every
  name the transcriber mangled. If it is absent, **warn the user** that notes
  will have no `termIds` and the Markdown will have no "Terms on this slide"
  blocks, and offer to run `/lecture-terms <lecture-dir>` first. Only continue
  without it if they say to.
- `events.jsonl` and `recording.json` are optional. Without them there are no
  typed student notes and no slide windows; the transcript's own `slide` field
  still places every segment.

Run the CLI from the repo root as:

```bash
node lecture-companion/cli/bin/lecture.mjs <cmd>
```

If `lecture-companion/cli/dist` does not exist, build it once first:

```bash
npm --prefix lecture-companion run build
```

## 2. Procedure

Read `lecture.json` and take `deck.pages` as N.

Walk the deck in batches of **6 pages**: 1-6, 7-12, ... up to N. Six, not eight:
a page of transcript is far more text than a page of slide lines, and a batch
has to stay small enough that you can read every segment properly.

For each batch `a-b` (with `b = min(a + 5, N)`):

1. **Context.** Get the batch's inputs:

   ```bash
   node lecture-companion/cli/bin/lecture.mjs notes-context <lecture-dir> --pages a-b
   ```

   It prints JSON: `lectureId`, `course`, `recordingPresent`, and `pages`, each
   with

   - `lines` — the slide's text lines, `id` and `text` (and `kind` when the
     grouper guessed one). **These ids are the `lineIds` you must use.** They
     are not contiguous: empty lines are dropped.
   - `terms` — `id`, `term`, `aliases` from the term index. **These ids are the
     `termIds` you must use**, and `term` is the spelling you should write.
   - `window` — the whole time the page was on screen, and `windows`, one entry
     per visit. A page shown twice has two windows and two stretches of
     transcript; write notes from both.
   - `segments` — what was said while the page was up, `start`, `end`, `text`.
   - `studentNotes` — what the student typed, `t` and `text`.

   A page with `window: null`, no `segments` and no `studentNotes` was **never
   shown**. Write it as a page with an empty `notes` array. That is the correct
   answer, not a gap to fill.

   You do **not** need the page images. This step is text against text: the
   lines are how you address positions, the transcript is the content. Read an
   image only if a note makes no sense without seeing the slide.

2. **Write the partial.** Apply the prompt in section 3 to the batch and write
   the result with a Bash heredoc (not the Write tool), so the JSON lands in one
   shot:

   ```bash
   mkdir -p <lecture-dir>/.lecture/notes.partial
   cat > <lecture-dir>/.lecture/notes.partial/batch-01.json <<'JSON'
   {"pages": [ ... ], "openQuestions": [ ... ]}
   JSON
   ```

   Name the files `batch-01.json`, `batch-02.json`, ... in batch order. The file
   holds `pages` and `openQuestions` **and nothing else** — no `schema`, no
   `lectureId`, no `generated`. Those come from the merge.

3. **Validate immediately**, before starting the next batch:

   ```bash
   node lecture-companion/cli/bin/lecture.mjs merge notes <lecture-dir> --check
   ```

   `--check` validates every partial written so far against the `NotePage`
   schema, writes nothing, and prints two lists: pages not written yet, and — the
   one that matters — which of those were actually shown in the lecture. Its
   errors name the file and the page, e.g.
   `batch-01.json page 3: notes.2.tag: Invalid option ...`. Fix the batch you
   just wrote before moving on. Exit code 1 means something is wrong; do not
   continue.

**Resumability.** Run `merge notes <lecture-dir> --check` before the first batch
of a run: whatever it lists as already validating is done, and the pages it
reports as not written yet are what is left. Skip the batches whose file exists
and validates; you are resuming an interrupted run. Never rewrite a good
partial, and never widen or narrow a batch's page range between runs — two files
covering the same page is an error at merge time.

After the last batch:

```bash
node lecture-companion/cli/bin/lecture.mjs merge notes <lecture-dir>
node lecture-companion/cli/bin/lecture.mjs export-md <lecture-dir>
node lecture-companion/cli/bin/lecture.mjs status <lecture-dir>
```

`merge notes` validates every page, refuses duplicates and pages outside the
deck, reassigns every note id as `n-<page>-<k>` in reading order, dedupes the
open questions, writes `notes.json` and stamps `lecture.json`.

It **fails** if a page the transcript covers has no partial — that is the check
that you did not silently skip a page that was shown and talked over. A page
that was never shown is fine and needs no flag. Pass `--allow-missing` only when
a shown page genuinely earned zero notes *and* you deliberately left it out of
every batch; the better answer is almost always to include the page with an
empty `notes` array. Add `--clean` to delete the partials once you trust the
result.

`export-md` renders `<lecture-id>.md` next to the deck, with the term index
folded in. Add `--quotes` to keep each generated note's transcript evidence in
the file as a nested blockquote; the default leaves it in `notes.json` only.

## 3. The prompt

Apply this to every page of the batch. It is the contract; do not improvise a
different shape.

```
You are turning what a professor said over each slide into the notes a
careful student would have written, if they had not needed to listen at the
same time. The slide is already a document the student can reread. Your job
is the unwritten layer: what was said that is not on the slide.

For each page you are given: its text lines with ids, its terms and passages
from the term index, the transcript of what was said while it was shown
(with times), and any notes the student typed (with times).

Write notes for the page:
- A note is one line, at most 40 words, in plain declarative English, in the
  professor's framing, not yours.
- Include only what is NOT on the slide: intuition, why it matters, worked
  examples, asides, corrections to the slide, exam hints, connections to
  earlier lectures, caveats, opinions, and definitions that were spoken but
  not printed. If the professor only read the slide, write no notes for it.
  Zero is a valid count. Do not paraphrase the slide to fill space.
- Tag each note with the lines it is about (lineIds), the terms it involves
  (termIds), the time span of the transcript it comes from (tStart, tEnd),
  and a short verbatim quote (at most 25 words) as evidence. If it is
  general to the page, lineIds is empty.
- Choose one tag from: intuition, why-it-matters, example, aside, correction,
  exam-hint, connection, caveat, definition-spoken.
- Confidence: high when the quote states it directly; medium when you
  inferred it across sentences; low when the transcript is garbled and you
  are reconstructing. Never present a low-confidence note as fact: hedge it
  in the text ("seemed to say...").

Student notes:
- Copy each typed note verbatim as a note of kind "student" with tag
  "student" and its time. Attach lineIds if it clearly refers to a line.
- If a student note is a question and the transcript answers it within the
  page window or the next page, add the answer in the answer field with a
  quote, and do not also emit a generated note saying the same thing; the
  answer lives under the question. Otherwise add it to openQuestions.
- If the professor posed a question and left it open, add it to
  openQuestions with source "professor".

Transcript quality: it is machine transcription of lecture-hall audio. Names
and symbols may be misspelled; the term index tells you the correct forms.
Prefer the term index spelling in your notes.

Output: JSON only, {"pages": [...], "openQuestions": [...]} matching the
schema below.
```

### The shape, one page at a time

This is one page of the `pages` array plus one `openQuestions` entry, annotated.
The comments are for you — the file you write is plain JSON with no comments.

```jsonc
{
  "pages": [
    {
      "page": 3,                        // 1-based, the same numbering as notes-context
      "title": "The certificate",       // as printed; "" when the slide has no title
      "startS": 330,                    // copy the page's `window`; null when it was never shown
      "endS": 900,
      "notes": [
        {
          // id is optional in a partial: the merge assigns "n-<page>-<k>" in
          // reading order. Write it or leave it out, it will be replaced.
          "kind": "generated",
          "text": "The worst case classifier is a half space, which is why the radius is Phi inverse of the vote probability rather than a looser tail bound.",
                                        // one line, <= 40 words, the professor's framing
          "lineIds": [3],               // line ids from this page's `lines`; [] if general to the page
          "termIds": ["t-phi-inverse", "t-certified-radius"],
                                        // term ids from this page's `terms`
          "tStart": 406.36,             // the transcript span it came from
          "tEnd": 444.27,
          "quote": "once the worst case is a half space, the distance from the centre of a Gaussian to a half space of a given mass is exactly fee inverse of that mass",
                                        // <= 25 words, verbatim, generated notes only
          "tag": "why-it-matters",      // intuition | why-it-matters | example | aside | correction
                                        // | exam-hint | connection | caveat | definition-spoken
          "confidence": "high"          // high | medium | low
        },
        {
          "kind": "student",
          "text": "why Phi inverse and not a tail bound?",
                                        // the typed note VERBATIM, never reworded
          "lineIds": [3],               // attach lines only when it clearly refers to them
          "termIds": ["t-phi-inverse"],
          "tStart": 380,                // the `t` the note was typed at
          "tEnd": 444.27,               // when the transcript answers it, the end of the answer
          "tag": "student",             // always "student" for a typed note
          "answer": "Phi inverse comes from the Neyman-Pearson argument: the worst case is a half space, so the distance is exact rather than a bound.",
                                        // only when the transcript answers it; otherwise omit
                                        // the field and put the question in openQuestions
          "confidence": "high"
        }
      ]
    }
  ],
  "openQuestions": [
    {
      "text": "Does the certificate still mean anything if the attacker knows sigma and can pick the input?",
      "page": 6,                        // the page it was asked on
      "source": "professor",            // student | professor
      "tStart": 1176.92                 // null when it has no time
    }
  ]
}
```

### The constraints, all enforced by `merge notes`

- **`text`: at most 40 words**, one line, plain declarative English, in the
  professor's framing. A student note's `text` is the typed note **verbatim**,
  including its typos.
- **`quote`: at most 25 words**, verbatim from a `segments` entry, generated
  notes only. It is evidence, not a second copy of the note.
- **`tag`** is one of: `intuition`, `why-it-matters`, `example`, `aside`,
  `correction`, `exam-hint`, `connection`, `caveat`, `definition-spoken`,
  `question`, `student`. Nothing else validates. A typed note is always
  `student`.
- **`confidence`**: `high` when a quote states it directly; `medium` when you
  inferred it across sentences; `low` when the transcript is garbled and you are
  reconstructing. A `low` note must hedge **in its own text** ("seemed to say
  ..."), because the Markdown does not print the confidence.
- **`lineIds`** are line ids from *this page's* `lines` in `notes-context`, and
  nothing else. They become the Obsidian selection link, so a wrong id points
  the reader at the wrong sentence. `[]` is correct and common: it means the
  note is about the page, not a line.
- **`termIds`** are ids from *this page's* `terms`. `[]` when no term applies.
- **`tStart` / `tEnd`** are seconds on the audio clock, from the `segments` you
  used. `null` only when the note comes from no particular moment.
- **`page`**: every page of the batch appears exactly once, in order, even when
  its `notes` array is empty.
- **`startS` / `endS`**: copy the page's `window`, or `null` when `window` is
  null.

## 4. Quality bar and pitfalls

- **Transcript minus slide.** Before you write a note, find the line it would
  duplicate. If you can, do not write it. "Add Gaussian noise at prediction
  time" is on the slide; "you have to train at the same sigma you certify at" is
  not. The second is a note, the first is noise.
- **Zero is a real answer.** A page the professor read out verbatim gets
  `"notes": []`. So does a page that was never shown. Padding a page to look
  productive is the main way this step goes wrong.
- **A page shown twice has two windows.** The second visit is usually the
  professor correcting or completing the first, which is exactly the material
  worth keeping. Read both stretches of `segments`.
- **Prefer the term index spelling.** The transcript is lecture-hall audio:
  "fee inverse" is `Phi inverse`, "Neiman Pearson" is Neyman-Pearson. The
  `terms` array gives you the correct form; use it in `text` and leave the
  mangled spelling in `quote`, which is verbatim by definition.
- **A typed note is a quotation.** Copy it exactly. Add an `answer` when the
  transcript answers it inside the page window or the next page, with the
  answer in your own compressed words and `tEnd` at the end of the answer.
  Otherwise leave `answer` out and add the question to `openQuestions`.
- **Open questions are for what stayed open**: a student question the lecture
  never answers, and a question the professor posed and left hanging
  (`source: "professor"`). Do not restate answered questions there.
- **Do not invent times.** Every `tStart` should be traceable to a segment you
  actually read.
- **Keep the partials small.** One batch is 6 pages, one file. Do not merge two
  batches into one file.

## 5. Report back

When the merge and the export are done, tell the user:

- the batches you wrote, and how many pages were covered;
- **notes per page**, as a short table (page, generated, student, terms on the
  page), with the pages that got zero notes called out and why — never shown, or
  the professor only read the slide;
- **student questions: answered vs open**, listing each open one;
- **every note you marked `confidence: "low"`**, with its page and text, so they
  can correct it against the audio;
- anything the transcript garbled badly enough that you left it out;
- **the path of the Markdown file**, and that it is ready to open in Obsidian.

Then the next step:

```
open <lecture-dir>/<lecture-id>.md
```
