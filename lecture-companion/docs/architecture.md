# Phase 3 — Architecture

Status: awaiting approval before Phase 4 (implementation).
Assumptions carried from Phase 2 (change any of them and I will adjust):
lectures live at `<vault>/Lectures/<course>/<lecture-id>/`; decks are PDF;
three commands on lecture day is acceptable for v1.

## 1. Shape of the system

Three programs, one folder per lecture, files as the only contract between them.

```
                 pre-lecture                 lecture day                post-lecture
             ┌──────────────────┐        ┌──────────────────┐       ┌──────────────────┐
  Node CLI   │ prepare          │        │                  │       │ export-md        │
  (lecture)  │  spans.json      │        │                  │       │  <id>.md         │
             │  pages/*.png     │        │                  │       │                  │
             └────────┬─────────┘        └──────────────────┘       └────────▲─────────┘
                      │                                                       │
  Claude Code ┌───────▼──────────┐                                   ┌────────┴─────────┐
  skills      │ /lecture-terms   │                                   │ /lecture-notes   │
              │  terms.json      │                                   │  notes.json      │
              └───────┬──────────┘                                   └────────▲─────────┘
                      │                                                       │
  Python CLI  ┌───────▼──────────┐       ┌──────────────────┐        ┌────────┴─────────┐
  (lecture-rec)│ bias (derived)  │       │ record           │        │ transcribe       │
              │  bias.json       │       │  audio.wav       │        │  transcript.json │
              └──────────────────┘       │  heartbeat.json  │        └──────────────────┘
                                         └──────────────────┘
  Chrome app                              ┌──────────────────┐        ┌──────────────────┐
  (Vite/React)                            │ Lecture mode     │        │ Review mode      │
                                          │  events.jsonl    │        │  reads notes,    │
                                          │  reads terms,    │        │  terms, spans    │
                                          │  spans, heartbeat│        │                  │
                                          └──────────────────┘        └──────────────────┘
```

Why this split, in plain language: each piece runs where it is best. Python owns
the microphone and the transcription model. Claude Code owns anything that needs
judgment, on your subscription, with no keys. Node owns the deterministic PDF work
so span IDs are identical offline and in the browser. The browser is only a
viewer and a note pad. Because they only share files, any one can be rewritten
without touching the others, and every step can be re-run.

## 2. Repository layout

```
lecture-companion/
  package.json                 npm workspaces: packages/core, cli, app
  packages/core/               TypeScript, shared by cli and app, no DOM dependency
    src/schemas/               zod schemas for every JSON contract below, exported types
    src/spans/                 line grouping, box math, selection->span mapping (pure)
    src/lookup/                term ranking for highlight-to-explain (pure)
    src/export/                notes+terms -> Markdown (pure)
    src/obsidian.ts            selection-link builder
    test/fixtures/             two small PDFs (LaTeX/Beamer-style, PowerPoint-style)
  cli/                         `lecture` Node CLI on pdfjs-dist@6.3.289 legacy build
  app/                         Vite + React + TypeScript, Chrome only
  pipeline/                    Python `lecture-rec` (the spike, promoted) + eval commands
  spike/                       promoted to pipeline/ in Phase 4 task 3
  docs/
.claude/skills/
  lecture-bias-terms/          exists
  lecture-terms/               precompute skill (Phase 4 task 2)
  lecture-notes/               notes + anchoring skill (Phase 4 task 6)
```

## 3. The lecture folder (the contract)

```
<vault>/Lectures/<course>/<lecture-id>/
  lecture.json          LectureManifest          written by: lecture prepare; status updated by every step
  deck.pdf                                       copied by: lecture prepare
  spans.json            SpanIndex                lecture prepare (Node, pdf.js)
  pages/p001.png ...    page renders, 1.5x       lecture prepare (for the skills' eyes only)
  terms.json            TermIndex                /lecture-terms
  bias.json             BiasTerms                lecture bias (derived from terms.json) or /lecture-bias-terms
  audio.wav                                      lecture-rec record
  recording.json        RecordingMeta            lecture-rec record
  .lecture/heartbeat.json  Heartbeat             lecture-rec record, every 2 s
  events.jsonl          Event per line           app (slide, note), lecture-rec (start, stop)
  transcript.json       Transcript               lecture-rec transcribe
  notes.json            LectureNotes             /lecture-notes
  <lecture-id>.md       Markdown export          lecture export-md
  .lecture/*.partial/   skill batch outputs      skills; merged by lecture merge
```

Rules: every JSON file carries a `schema` string with a version. Producers never
overwrite a file that a later step depends on without bumping `lecture.json`
status. The app never writes anything except `events.jsonl` and `lecture.json`
status. Markdown is written as `<name>.md.tmp` then moved into place.

## 4. Data contracts

Types are given in TypeScript; zod schemas in `packages/core` are the source of
truth and `lecture validate <file>` checks any file against them.

### 4.1 LectureManifest (`lecture.json`)

```ts
type LectureManifest = {
  schema: "lecture/1";
  lectureId: string;            // folder name, e.g. "2026-09-15-lec05"
  course: string;               // e.g. "TDL"
  courseTitle?: string;
  number?: number;              // lecture number if known
  title?: string;               // from the deck's first page, editable
  date: string;                 // YYYY-MM-DD
  deck: { file: "deck.pdf"; sha256: string; pages: number };
  pdfjs: { version: "6.3.289"; includeMarkedContent: false; disableNormalization: false };
  status: {
    prepared?: string; terms?: string; recorded?: string;
    transcribed?: string; notes?: string; exported?: string;   // ISO timestamps
  };
  priorLectures?: string[];     // lectureIds, oldest first, used as context by /lecture-terms
};
```

### 4.2 SpanIndex (`spans.json`)

The span ID is the index into pdf.js's string-bearing text items for that page,
empty strings included. That is the same index the pdf.js `TextLayer` uses for
`textDivs` and the same index Obsidian's selection links use.

```ts
type SpanIndex = {
  schema: "spans/1";
  pdfjsVersion: "6.3.289";
  extractOptions: { includeMarkedContent: false; disableNormalization: false };
  deckSha256: string;
  pages: SpanPage[];
};
type SpanPage = {
  page: number;                 // 1-based
  width: number; height: number; // PDF user units at scale 1, rotation applied
  items: SpanItem[];            // index in this array == span id
  lines: SpanLine[];            // derived grouping, reading order
};
type SpanItem = {
  id: number;
  str: string;                  // may be ""
  box: [left: number, top: number, width: number, height: number]; // top-left origin, scale 1
  transform: [number, number, number, number, number, number];     // raw pdf.js, for fidelity
  font: string;
  eol: boolean;
};
type SpanLine = {
  id: number;                   // index in lines[]
  items: number[];              // span ids, left to right
  text: string;                 // items joined, single-spaced, trimmed
  box: [number, number, number, number];
  kind?: "title" | "bullet" | "math" | "caption" | "text";  // heuristic, may be absent
};
```

Line grouping (pure function in core, unit-tested): items on the same page are
grouped when their baselines differ by less than 0.5 of the taller item's height
and their horizontal gap is less than 2.5 average character widths; lines are
sorted top to bottom then left to right; single-character math runs collapse
into their line. Lines, not items, are what prompts and notes reference, because
LaTeX fragments a formula into dozens of items. Items remain the addressable
unit for selection and for Obsidian links.

### 4.3 TermIndex (`terms.json`) — produced by `/lecture-terms`

```ts
type TermIndex = {
  schema: "terms/1";
  lectureId: string; course: string; generated: string;
  pages: TermPage[];
  glossary: GlossaryEntry[];    // deck-wide, deduplicated by id
};
type TermPage = {
  page: number;
  title: string;                // as printed, or "" for untitled
  summary: string;              // one sentence: what this page does in the lecture's argument
  overlayGroup?: number;        // pages that are incremental builds of one logical slide share a number
  terms: Term[];
  passages: Passage[];
  asrBias: string[];            // ranked, spoken spellings, max 40
};
type Term = {
  id: string;                   // "t-" + kebab-case canonical name; reuse ids from prior lectures
  term: string;                 // canonical display form, e.g. "randomized smoothing"
  aliases: string[];            // other spellings/notations on the slide, e.g. ["smoothing", "g(x)"]
  kind: "concept" | "notation" | "method" | "theorem" | "dataset" | "person" | "metric" | "other";
  lineIds: number[];            // lines on this page where it appears
  definition: string;           // <= 2 sentences, precise
  intuition: string;            // <= 2 sentences, plain language, why it exists
  inThisCourse: string;         // how THIS course notates/uses it; "" if generic
  firstSeen?: { lectureId: string; page: number };
  confidence: "high" | "medium" | "low";
};
type Passage = {
  lineIds: number[];            // a bullet, sentence, or equation group
  text: string;                 // the slide text, verbatim
  explanation: string;          // <= 3 sentences: what it says, in plain words, with the notation unpacked
};
type GlossaryEntry = Pick<Term, "id" | "term" | "aliases" | "kind" | "definition" | "intuition" | "inThisCourse" | "firstSeen"> & { pages: number[] };
```

`lecture bias` derives `bias.json` deterministically: per page `asrBias`
(fallback: terms' `term` and `aliases`); global = the union of all pages'
`asrBias` ranked by how many pages carry each spelling, capped at 60 (fallback,
only when no page has `asrBias`: glossary term names, never aliases, since
aliases are for lookup matching and would waste the prompt window). The existing `/lecture-bias-terms` skill stays as an
alternative producer of the same file.

### 4.4 Event (`events.jsonl`) — unchanged from the spike, `t` now optional

```ts
type Event = {
  t?: number;                   // seconds on the audio clock; absent when written by the app
  wall: string;                 // ISO-8601 with milliseconds and offset; always present
  type: "start" | "slide" | "note" | "stop";
  slide?: number;               // page number, for type "slide"
  text?: string;                // for type "note"
  source?: "app" | "recorder";
};
```

The recorder writes `start` and `stop` with both clocks. The app writes `slide`
and `note` with `wall` only. The transcriber computes `t = wall - recording.startedWall`
for events lacking `t`. Drift between the audio clock and the system clock over
75 minutes is far below one second; the slide granularity is seconds.

### 4.5 RecordingMeta, Heartbeat

`recording.json` is the spike's `RecordingMeta` with `startedWall` in ISO-8601
with milliseconds. `.lecture/heartbeat.json`:

```ts
type Heartbeat = { pid: number; startedWall: string; updatedWall: string; elapsedS: number; rmsRecent: number };
```

The app shows "rec 3s" from `updatedWall`; stale after 6 seconds; "no recorder"
if the file is absent.

### 4.6 Transcript (`transcript.json`) — the spike schema plus `schema`

```ts
type Transcript = {
  schema: "transcript/1";
  engine: string; model: string; condition: "plain" | "biased"; created: string;
  segments: { id: number; slide: number | null; start: number; end: number; prompt: string;
              text: string; words: { w: string; start: number; end: number }[] }[];
};
```

Production runs write only the biased condition to `transcript.json`; the eval
commands keep writing both under `transcripts/`.

### 4.7 LectureNotes (`notes.json`) — produced by `/lecture-notes`

```ts
type LectureNotes = {
  schema: "notes/1";
  lectureId: string; generated: string;
  pages: NotePage[];
  openQuestions: OpenQuestion[];
};
type NotePage = {
  page: number; title: string;
  startS: number | null; endS: number | null;   // from events; null if the page was never shown
  notes: Note[];
};
type Note = {
  id: string;                   // "n-<page>-<n>"
  kind: "generated" | "student";
  text: string;                 // one line, <= 40 words; student notes verbatim
  lineIds: number[];            // slide lines this relates to; [] if general to the page
  termIds: string[];
  tStart: number | null; tEnd: number | null;   // seconds on the audio clock
  quote?: string;               // <= 25 words of transcript evidence, generated notes only
  tag: "intuition" | "why-it-matters" | "example" | "aside" | "correction" | "exam-hint"
     | "connection" | "caveat" | "definition-spoken" | "question" | "student";
  answer?: string;              // for student questions the transcript answers
  confidence: "high" | "medium" | "low";
};
type OpenQuestion = { text: string; page: number; source: "student" | "professor"; tStart: number | null };
```

### 4.8 Markdown export (`<lecture-id>.md`) — rendered by code from notes + terms

```markdown
---
course: TDL
lecture: 5
title: Certified Defenses
date: 2026-09-15
deck: "[[deck.pdf]]"
generated: 2026-09-15T20:14:00-04:00
---

# Lecture 05: Certified Defenses

## Slide 7: Randomized smoothing  [[deck.pdf#page=7]]

- The professor stressed that σ is chosen at training time, not at certification time. [[deck.pdf#page=7&selection=12,0,14,18|slide]] `13:50`
- **me:** ask why Φ⁻¹ and not the Gaussian tail bound `13:41`
  - answered: Φ⁻¹ comes from the Neyman-Pearson argument, the tail bound is looser `13:58`

Terms on this slide
- **randomized smoothing**: definition. Intuition: one plain sentence. Here: how this course uses it.

## Open questions

- Why does the certificate degrade with dimension? (slide 9, `21:03`)
```

Rules: one file per lecture; every page that has notes or terms gets a
second-level header with the page number and an Obsidian page link; note lines
carry a selection link built from the first and last item of their `lineIds`
(begin item, 0, end item, length of its string) when `lineIds` is non-empty;
timestamps are mm:ss on the audio clock; student notes are bold-prefixed with
"me:"; generated notes get no prefix; quotes are omitted by default and
included with `--quotes`. No middots, no all-caps labels.

## 5. The precompute prompt (`/lecture-terms`)

Inputs the skill assembles: `lecture.json`, `spans.json` (lines only, per page),
`pages/p*.png`, and the `glossary` arrays of the `priorLectures` term indexes,
compacted to id, term, aliases, one-line definition.

Process: batches of 8 pages. For each batch the skill reads the eight PNGs with
the Read tool, the eight pages' lines from spans.json, and writes
`.lecture/terms.partial/batch-NN.json` containing a `pages` array only. After
all batches, `lecture merge terms <dir>` merges, dedupes the glossary by id,
validates, and writes `terms.json`. Then `lecture bias <dir>`.

The prompt (this text goes in SKILL.md verbatim, with the schema appended):

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

Why images plus lines and not text only: the Phase 2 measurement showed math
in the text layer is correct Unicode but fragmented into one-character items;
the image lets the model read a formula as a formula, while lineIds let it
point at where the formula is.

## 6. The notes and anchoring prompt (`/lecture-notes`)

Inputs: `spans.json` lines per page, `terms.json` (page terms and passages),
`transcript.json`, `events.jsonl` (student notes with times, slide timing),
`lecture.json`. The skill computes each page's time window from slide events
and gathers the transcript segments inside it.

Process: batches of 6 pages; writes `.lecture/notes.partial/batch-NN.json`;
`lecture merge notes <dir>` merges, validates, assigns ids, writes `notes.json`;
`lecture export-md <dir>` renders Markdown.

The prompt:

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
  quote. Otherwise add it to openQuestions.
- If the professor posed a question and left it open, add it to
  openQuestions with source "professor".

Transcript quality: it is machine transcription of lecture-hall audio. Names
and symbols may be misspelled; the term index tells you the correct forms.
Prefer the term index spelling in your notes.

Output: JSON only, {"pages": [...], "openQuestions": [...]} matching the
schema below.
```

Why anchoring is text matching: the model sees lines with ids and transcript
text, and emits lineIds. No vision, no coordinates. The app already knows the
boxes for every line.

## 7. Lookup algorithm (highlight to explain), in `packages/core/lookup`

Input: the selection resolved to `{page, beginItem, beginOffset, endItem, endOffset}`
and the selected text. Steps:

1. Lines touched: every line whose items intersect `[beginItem, endItem]`.
2. Candidates: terms on the page whose `lineIds` intersect the touched lines;
   passages whose `lineIds` intersect; glossary entries whose `term` or an alias
   matches the selected text case-insensitively, whitespace-collapsed, allowing
   hyphen and space to interchange.
3. Rank: exact term or alias match first; then term on the touched lines with the
   most overlap; then the passage with the most overlap; then the page summary.
4. Render: the top term as the card's phrase, definition and intuition, plus
   `inThisCourse` when non-empty. The passage explanation leads instead, with the
   intersecting terms as chips, when the selection runs past eight words, or
   covers all of a passage's lines without naming exactly one term. A selection
   that names one term is that term's question; one that names none or several
   is the passage's. Terms the selection names outrank terms that merely share a
   line.
5. Nothing found: show the page summary and up to three glossary entries by
   substring match, and say "not in the index" plainly.

The `t` key cycles through the page's terms in `lineIds` order and highlights
their lines; `e` or Enter opens the card for the cursored term.

## 8. Storage adapter (app)

```ts
interface LectureFolder {
  readJson<T>(name: string): Promise<T | null>;
  readBinary(name: string): Promise<ArrayBuffer>;
  appendLines(name: string, lines: string[]): Promise<void>;   // buffered by the caller
  writeAtomic(name: string, text: string): Promise<void>;      // tmp then move
  list(): Promise<string[]>;
  watch(name: string, cb: () => void): () => void;             // FileSystemObserver, falls back to 3 s poll
}
```

Two implementations: `FsaLectureFolder` (File System Access API, production) and
`DevServerLectureFolder` (a Vite dev middleware serving a local folder, used
only for automated testing in this container and never shipped in the
production build). Event buffering lives above the adapter: the app queues
events and flushes on slide change, blur, hidden, or three seconds idle.

## 9. Screens and keymap

The visual spec, tokens, wireframes, highlight states, and component inventory
are in `ui-direction.md` and are binding. This section adds behavior.

Library. Lists courses and lectures from the vault folder. Status pips:
prepared, terms, recorded, transcribed, notes. Enter opens a lecture in the
mode that makes sense: Lecture mode if not yet recorded, Review mode if notes
exist. First run asks for the vault folder once and stores the handle.

Lecture mode. Resting state: slide plus 28 px strip. Keys as in the keymap.
Slide change writes an event. `n` opens the note input above the strip; Enter
commits with the current page and time; Esc cancels. Selecting text and
pressing `e` opens the lookup card anchored to the selection; Esc closes.
`t` cycles terms. The strip shows page n of N, recorder elapsed or "no
recorder" in the stale color, note count, and the mode word. If `terms.json` is
missing the strip says "no term index" and `e` shows the page summary only.

Review mode. Slide left, note rail right, glossary collapsible. Hover or focus
on a note line tints its lines on the slide; hover on a slide line tints its
notes. `j`/`k` move between notes, Enter on a note opens its quote inline,
`g` toggles the glossary, `o` opens the Markdown in Obsidian via
`obsidian://open?path=...`, and Option+E re-exports. Pages with no notes are
skipped by `]`/`[` (next/previous page with notes).

Keymap: as in `ui-direction.md` section D, plus `]`/`[` above and `o` in review.
The KeyRouter is a five-state machine and the only place `preventDefault` is
called.

## 10. Implementation sequence (Phase 4)

Each task is one Opus subagent, one brief, one review, and ends in something
runnable. Order is chosen so the lecture-day path works by task 4 and the
first real lecture can be recorded with the spike in the meantime.

| # | Task | Owns | Runnable result | I verify by |
|---|---|---|---|---|
| 1 | Monorepo scaffold, `core` schemas, span extraction, line grouping, `lecture prepare/validate/render-pages` | `package.json`, `packages/core`, `cli` | `lecture prepare` on a fixture PDF produces a valid `spans.json`, PNGs, `lecture.json` | running it here; determinism hash test; line grouping tests on both fixtures |
| 2 | `/lecture-terms` skill, `lecture merge terms`, `lecture bias` | `.claude/skills/lecture-terms`, `cli` merge/bias | a valid `terms.json` and `bias.json` for the fixture deck | invoking the skill myself on the fixture and validating |
| 3 | Promote spike to `pipeline/`: heartbeat, wall-to-audio-clock events, `transcript.json` with schema, keep eval | `pipeline/` | synthetic lecture runs end to end with app-style events | running it here; tests |
| 4 | App: shell, tokens, KeyRouter, storage adapter (FSA + dev), Library, Lecture mode with slide render, navigation, note capture, buffered events, heartbeat | `app/` | open a prepared folder, advance slides, type notes, see events land | Playwright against the dev adapter with a fixture folder |
| 5 | Lookup: SelectionWatcher, span mapping, `core/lookup`, LookupCard, TermCursor | `app/`, `core/lookup`, `core/spans` | highlight a phrase, press `e`, see the right entry | Playwright: select text programmatically, assert card content |
| 6 | `/lecture-notes` skill, `lecture merge notes`, `lecture export-md` | `.claude/skills/lecture-notes`, `cli`, `core/export` | `notes.json` and Markdown for the synthetic lecture | invoking the skill myself; validating; checking Obsidian links |
| 7 | Review mode: NoteRail, AnchorLayer, reciprocity, glossary, navigation | `app/` | review the synthetic lecture with highlights | Playwright |
| 8 | Finish: self-hosted fonts, reduced motion, command palette, keymap overlay, runbook, remove `spike/` | `app/`, `docs/` | a written lecture-day and post-lecture runbook that I have executed on the fixture end to end | executing the runbook |

Task 4 is the largest and may be split into 4a (shell, adapter, Library,
render, navigation) and 4b (note capture, events, heartbeat) if the first
brief comes back over budget.

## 11. Risks I am carrying into Phase 4

- Obsidian's selection-link index had an off-by-one in one release. Export is
  best-effort for that link; page links always work.
- pdf.js pinned at 6.3.289 must be pinned in both `cli` and `app`; a CI test
  hashes the fixture extraction so drift is caught.
- The File System Access API cannot be driven by Playwright, so browser tests
  use the dev adapter; the FSA path gets a manual checklist in the runbook.
- Whether `/lecture-terms` on a 60-page deck fits comfortably in one Claude
  Code session is untested. Batching to partial files keeps any single step
  small and resumable.
- Google Slides exports have poor line order. Line grouping sorts by geometry,
  not item order, which should cover it; the second fixture PDF tests this.
