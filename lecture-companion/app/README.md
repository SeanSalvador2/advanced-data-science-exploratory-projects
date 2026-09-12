# `@lecture/app`

The Chrome page you look at during a lecture, and the one you read it back in
afterwards. Tasks 4, 5 and 7 of the Phase 4 sequence: the shell, the storage
adapter, the Library, Lecture mode (slide render, navigation, note capture,
buffered events, recorder heartbeat), highlight-to-explain (selection mapping,
the lookup card, the term cursor, the anchor layer) and Review mode (the note
rail, reciprocal highlighting, the glossary). Fonts and the command palette are
task 8.

Stack: Vite 6, React 19, TypeScript strict, CSS Modules over one global
`tokens.css`. Runtime dependencies are React, `pdfjs-dist` pinned to 6.3.289,
`@lecture/core` and `idb-keyval`. No component library, no Tailwind, and no
network fetch on the lecture path.

## Run it in Chrome against a real folder

```
cd lecture-companion
npm install
npm run build --workspace @lecture/core
npm run dev --workspace @lecture/app
```

Open <http://localhost:5175> in Chrome and press **Choose your lectures
folder**. Point it at the folder that holds your courses — the one whose
children look like `TDL/2026-03-04-lec09/lecture.json`. Pointing it straight at
a single course folder works too. The handle is remembered in IndexedDB, so the
next visit goes straight to the Library; if Chrome asks again, the screen offers
one **Reopen vault** button, because `requestPermission` only works from a
click.

Only two kinds of write ever leave the app: `events.jsonl` in the lecture you
have open, and (later) a `lecture.json` status stamp. Everything else in the
folder is read-only to it.

## Run it with the dev adapter (no folder picker)

The File System Access API cannot be driven by Playwright, so there is a second
adapter that talks to a Vite dev-server middleware. It is only mounted by `vite
dev`, its client half is behind `import.meta.env.DEV`, and `npm run build`
greps the bundle to prove it is not in production output.

```
cd lecture-companion/app
LECTURE_DEV_ROOT=/path/to/a/vault npm run dev
```

Then open <http://localhost:5175/?dev#/library>. The `?dev` is what selects the
adapter; without it the app asks for a folder as usual.

## Tests

```
npm test --workspace @lecture/app      # vitest: FSM, event buffer, scan, span ids, selection, placement
cd app && npx playwright test          # Chromium, against the dev adapter
```

The browser tests build their own vault under `app/test-results/vault`: course
`TEST` holds the two prepared fixture lectures, and course `TDL` holds
`2026-09-15-lec05`, the recorded, transcribed and noted lecture review mode is
tested against (`lecture prepare` on the html fixture deck, the five artefacts
from `cli/test/fixtures/notes-lecture/`, then `lecture export-md`). Each is
built once and cached under `/tmp/lec-*`. Screenshots land in
`app/e2e/screenshots/`.

The root `package.json` carries `"overrides": { "vite": "^6.4.3" }` so that
vitest's own dependency cannot pull a second, newer Vite into the tree; the
stack for this task is fixed at Vite 6.

`@playwright/test` is pinned to 1.56.0 on purpose: that is the release whose
Chromium revision matches the browser preinstalled in the development container,
and `playwright install` must not run there.

## Keys implemented so far

| Key | Where | What it does |
|---|---|---|
| Right, Space, PageDown | lecture, review | Next slide |
| Left, Shift+Space, PageUp | lecture, review | Previous slide |
| 0–9 then Enter | lecture, review | Jump to that slide; Backspace edits, Esc clears |
| `n` | lecture | Open the note field; Enter commits, Esc cancels |
| `e` | lecture, review | Explain the selection, or the term the cursor is on |
| `t` / `Shift+T` | lecture, review | Step the cursor forwards or backwards through this slide's terms |
| Enter | lecture, card open | Open the card for the term the cursor is on |
| Esc | lecture, card open | Close the card; a second Esc clears the term cursor |
| `-` / `=` | lecture | Dim and brighten the slide canvas |
| `j` / `k` | review, library | Move the cursor; rows and notes are focusable, so Tab works too |
| Enter | review | Show a note's quote, or a question's answer; explain a focused glossary entry |
| `g` | review | Open and close the glossary |
| `]` / `[` | review | Next and previous slide that has notes |
| `o` | review | Open this lecture's Markdown in Obsidian |
| Option+E | review | Says which command re-exports the Markdown |
| Enter | library | Open the lecture (Review if it already has notes) |
| `r` | library | Rescan the folder |
| Option+1 / 2 / 3 | anywhere | Lecture, review, library |
| Option+T | anywhere | Switch between the dark and light theme |
| `?` | anywhere | The keymap overlay |
| Esc | anywhere | Back out one level |

Every key goes through one `keydown` listener and one five-state machine
(`idle`, `numberEntry`, `noteInput`, `cardOpen`, `palette`); it is the only
place `preventDefault` is called. Bare letters fire only in `idle` and
`cardOpen`, which is why typing `n` inside the note field inserts an `n`. No
Cmd combination is bound anywhere.

## Highlight to explain

Select a phrase on the slide and press `e`. `SelectionWatcher` resolves the
selection to `{page, beginItem, beginOffset, endItem, endOffset}` through
`TextLayerHost.resolveNode`, the pure `lookup()` in `@lecture/core` ranks the
page's terms and passages against it, and the card opens anchored to the first
highlighted line with a leader line — no scrim, the slide stays lit.

- An exact term or alias hit wins first, on this page and then deck-wide; a
  selection that swallows a whole passage without singling out one term, or one
  longer than eight words, leads with the passage explanation and lists the
  terms as chips that Tab reaches and Enter opens; anything else falls back to
  the page summary under a plain "Not in the index".
- `t` and `Shift+T` step a cursor through the slide's terms in line order for
  keyboard-only use: the strip reads `term 3/6 certification time`, the term's
  lines take the hover tint, and `e` or Enter opens its card.
- Esc pops one level: the card first, then the cursor. A page change closes
  both.
- With no `terms.json` the strip says `no index`, and `e` says
  `no term index for this lecture` rather than opening an empty card.

The anchor layer draws one box per *visual line*, never per span, so a
highlight has no seams, and it multiplies onto the professor's page in both
themes. On the first page of a lecture that review mode draws, the canvas's
mean luminance is sampled into a 32 px offscreen canvas; below 0.5 the deck is
dark, the stage is stamped `data-deck="dark"`, and the layer switches to
`screen` blending with the on-dark fills. The answer is cached per lecture for
the life of the tab.

## Review mode

`#/review/<course>/<lecture>`, which is also what Enter opens in the Library
once a lecture has `notes.json`. A 36 px header — course, lecture number,
title, an **Open in Obsidian** button when the adapter knows a path, and the
page counter with any transient line beside it — then the slide on the left and
a fixed 580 px rail on the right whose text measure is 526 px.

- The rail is one line per note in `notes.json` order, which is the order the
  lecture happened in. Provenance is the visual class: a 2 px `--mine` rule in
  a 12 px gutter and italics for what the student typed, nothing for what the
  model wrote, and both share a text edge. The meta line is the timestamp on
  the audio clock, the tag for a generated note, and the word `confidence
  medium` or `confidence low` when the model hedged — never a coloured pill.
- Enter shows a generated note's transcript quote as a blockquote, or collapses
  a student question's answer. A page with no notes says so plainly.
- The open questions are listed once, after the notes of the last page that has
  any.
- Reciprocity is one hovered/focused pair (ui-direction.md §E). Every line a
  note cites rests under a 1 px underline; hovering or focusing a note tints
  its lines, and moving the pointer over one of those lines tints the gutter
  rule of every note that cites it. The focused note's lines go active. Hover
  on the slide is one `pointermove` on the stage tested against the line boxes,
  because the anchor layer takes no pointer events. Where two notes share a
  line there is still one box: the strongest state wins, so the focused note
  keeps the line it shares with a hovered one.
- `g` opens the glossary at the foot of the rail — the page's terms, never more
  than 40 % of the rail, remembered in localStorage. Enter on an entry opens
  the same lookup card `e` would.
- `]` and `[` jump to the next and previous page that has notes, and stop at
  the ends. `j` and `k` do the same in the rail: the last note is the last
  note, and falling off it never turns the page.
- The app never writes Markdown. `o` hands `<lectureId>.md` to Obsidian with
  `obsidian://open?path=`, which needs a real path — the dev adapter has one,
  the File System Access API does not and says so — and Option+E prints the
  command that re-renders it.

## Stubbed, and what is missing

- `n` is bound in lecture mode only: review has no recorder clock to stamp a
  note against.
- The Atkinson Hyperlegible faces are declared in `tokens.css` but the woff2
  files arrive in task 8; until then the fallback stack renders.
- pdf.js is loaded without `cMapUrl` or `standardFontDataUrl`, so a deck that
  references a standard font without embedding it is substituted by the browser
  rather than by pdf.js's own font data. Both fixture decks embed their fonts.
  Shipping those asset folders belongs with the font work in task 8.
- The theme toggle lives only in the keymap overlay, as specified.
- pdf.js 6.3 calls `Map.prototype.getOrInsertComputed`, which current Chrome
  has but the container's Chromium 141 does not. `pdf/getOrInsert.ts` installs a
  feature-detected shim, and when the engine lacks the methods the worker is
  started from `pdf/worker-shim.ts` — the same `pdf.worker.mjs` with the shim
  imported ahead of it, because a module worker is its own realm. On a browser
  that has them, the mandated
  `new Worker(new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url),
  { type: "module" })` is what runs.
- The five library pips read `lecture.json`'s `status` *or* the artefact each
  step writes (`spans.json`, `terms.json`, `audio.wav`, `transcript.json`,
  `notes.json`), because the producers are three separate programs and a
  hand-run step can leave the file without the stamp.

## Layout

```
src/
  App.tsx                  shell: route, theme, the one key listener, overlay
  keys/KeyRouter.ts        the five-state machine (pure, unit tested)
  keys/useKeys.ts          how a screen subscribes to key actions and the mode
  selection/SelectionWatcher.ts  selectionchange -> span ids, debounced
  lookup/useLookup.ts      the card, the term cursor and the one highlight
  lookup/LookupCard.tsx    the anchored card, its leader and its chips
  lookup/position.ts       placement: the 12 px offset, the flip, the clamps
  lookup/TermCursor.ts     the `t` cursor's step and its strip readout
  anchors/AnchorLayer.tsx  per-line highlight boxes over the canvas
  notes/pageIndex.ts       notes by page, refs by line, anchor state, hit test
  notes/luminance.ts       the dark-deck sample and its per-lecture cache
  notes/load.ts            one lecture folder, read for review
  events/EventBuffer.ts    queue and flush policy for events.jsonl
  events/time.ts           nowIso, mmss
  pdf/pdfjs.ts             worker setup, loadDocument, the fixed text options
  pdf/render.ts            renderPage, fitScale
  pdf/TextLayerHost.ts     the text layer and the span-id map
  pdf/resolve.ts           DOM position -> { itemId, offset } (no pdf.js import)
  pdf/getOrInsert.ts       shim for Map/WeakMap.getOrInsert*, feature detected
  storage/LectureFolder.ts the adapter interface (architecture.md §8)
  storage/fsa.ts           File System Access implementation
  storage/dev.ts           dev-server implementation, DEV only
  state/                   routes, persisted settings, vault lifecycle
  lib/library.ts           scanning the vault
  lib/heartbeat.ts         the recorder's state, as words
  screens/                 library, lecture, review, vault gate
  screens/review/Review.tsx        layout, keys, reciprocity, the dark sample
  screens/review/NoteRail.tsx      the note lines and the open questions
  screens/review/GlossaryPanel.tsx the collapsible glossary
  styles/tokens.css        the token set from ui-direction.md §A
  styles/text-layer.css    pdf.js text-layer geometry, adapted
```
