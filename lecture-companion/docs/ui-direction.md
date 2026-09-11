# UI direction (Phase 2c proposal, adopted with notes)

Produced by a design-research subagent following the frontend-design skill's
two-pass process. Architect's notes are marked "Architect:". This document is the
reference for every UI implementation brief in Phase 4.

Architect: adopted as written, with two adjustments. Cmd+K must be verified
against Chrome on macOS during implementation (fallback Option+K). KaTeX is
optional until the term index needs rendered math.

## A. Design plan

Subject grounding. The user is a grad student in trustworthy deep learning:
adversarial robustness, calibration, distribution shift. Their visual world is
notation, theorem structure, plot axes, LaTeX. Their physical situation is a dim
hall with a bright projected plate at the front and a laptop on their knees. The
organizing idea: the slide is the only lit object; everything the app adds is
marginalia around it. Second idea: provenance is a visual class. Professor's slide
untinted and never altered, model-generated cool, student-typed warm. Color encodes
who said it, not decoration.

Palette (same token names in both themes).

| Token | Dark (lecture default) | Light |
|---|---|---|
| `--surface` | `#13171C` | `#F1F3F5` |
| `--surface-raised` | `#1C222A` | `#FFFFFF` |
| `--rule` | `#2A323B` | `#D8DDE2` |
| `--ink` | `#DDE3E9` | `#1A1F26` |
| `--ink-muted` | `#8A939D` | `#616B75` |
| `--accent` (active anchor, focus ring, caret) | `#E9A23B` | `#B0700F` |
| `--mine` (student ink) | `#5FB3C4` | `#17697C` |
| `--stale` (heartbeat lost only) | `#D2705E` | `#A63C27` |

Dark is default in lecture mode, chosen at first paint from a persisted setting,
not from `prefers-color-scheme` (the room, not the OS, decides). `#13171C` is a
real slate, not near-black; pure black plus light text halates in a dark room.
Light is default in review and library.

The slide canvas is usually white; in a dark hall that is a floodlight. Apply a
dimmer to the canvas only: `filter: brightness(var(--dim)) contrast(1.03)`, `--dim`
default 0.86 dark / 1.0 light, adjustable with `-` and `=`. Brightness reduction,
never inversion. Highlight overlays sit above the filter.

Type. Atkinson Hyperlegible Next (UI, notes, glossary) and Atkinson Hyperlegible
Mono (status strip, slide numbers, code, inline symbols). Both SIL OFL 1.1,
self-hosted woff2, subset to Latin plus math/Greek. Drawn by the Braille Institute
for legibility under low contrast: unambiguous `l/1/I`, `O/0`, `rn/m`. Rendered
LaTeX, if needed, goes through KaTeX (MIT), self-hosted. Fallback stack:
`"Atkinson Hyperlegible Next", ui-sans-serif, system-ui`.

| Role | px / line-height | Weight |
|---|---|---|
| Status strip | 12 / 16, mono, letter-spacing .01em | 400 |
| Slide caption (review header) | 13 / 18 | 500 |
| Note line | 15 / 23 | 400 |
| Note meta (time, source) | 12 / 16, mono | 400 |
| Glossary term | 14 / 20 | 600 |
| Glossary body | 13 / 19 | 400 |
| Note input | 16 / 24 | 400 |
| Lookup card: phrase | 17 / 24 | 600 |
| Lookup card: body | 14 / 21 | 400 |
| Library row / course head | 14 / 20 and 20 / 26 | 400 / 600 |

Spacing scale (px): 2 4 6 8 12 16 24 32 48. Radius scale by role: 2 span
highlights, 4 inputs and chips, 8 lookup card, 0 panels and rules, 999 status pips.

Motion. `--t-tint 90ms`, `--t-collapse 140ms`, `--t-card 180ms`. Easing
`cubic-bezier(.2,.7,.2,1)`; opacity-only transitions linear. The one orchestrated
moment is the lookup card opening: over 180 ms the anchor span goes hover-tint to
active-tint (first 90 ms), a 1 px leader line scales from the anchor toward the
card, and the card fades in with `translateY(6px -> 0)`. Nothing else moves on its
own. Under `prefers-reduced-motion: reduce`, transforms drop and everything is a
90 ms opacity crossfade.

Principles. The slide is never restyled, only dimmed and overlaid. Chrome is
monochrome; the only saturated pixels are the active anchor and the student's own
ink. Every lecture-time affordance is invisible until invoked and gone when done;
the resting lecture screen is a slide, a 28 px strip, nothing else. Color and
shape carry provenance. Keyboard state is shown in the strip, not remembered.

## B. Genericness review

First pass was the template: Inter 14/20, `#0F0F0F` with violet `#8B5CF6`, a
centered scrimmed modal for lookup, 8 px radius everywhere, a green heartbeat dot,
an all-caps mode eyebrow, hover transitions on every row. Changes: Inter to
Atkinson Hyperlegible Next (a real environmental constraint); near-black plus
violet to slate plus amber/cyan provenance hues; centered modal to an anchored
card with a leader line so the slide stays visible; uniform radius to a role-based
scale; green dot and eyebrow to `rec 3s` in mono that turns stale only when late.

## C. Wireframes

Target display: MacBook Air default scaled 1470x956; Chrome windowed viewport
about 1470x852. Fixed dimensions below are for 1470x852; the slide box absorbs
extra height.

Lecture mode. Slide centered on both axes, nothing above it.

```
+---------------------------------------------------------------+
| 24                                                         24 |  pad 16 top
|    +-----------------------------------------------------+    |
|    |        pdf.js canvas + transparent text layer       |    |  slide box:
|    |                                                     |    |  16:9 -> 1422x800
|    +-----------------------------------------------------+    |  4:3  -> 1067x800
|                                                               |
|              +-----------------------------------+            |  note input 640x40
|              | |certified radius shrinks w/ depth|            |  hidden at rest
|              +-----------------------------------+            |
+---------------------------------------------------------------+
| 14/62   rec 3s   4 notes                                 lect |  28 px strip
+---------------------------------------------------------------+
  left-aligned, 16 px gutter, mono 12 px, items separated by 24 px
  of space (no middot chain). Mode name right-aligned.
```

Lookup card. 420 wide, max-height 320, anchored to the selection with a 12 px
offset, flipped above if the anchor is below the slide midline, clamped 24 px
inside the slide box.

```
   ...the l-inf ball of radius eps around x...
      ^^^^^^^^^^^^  active anchor, amber
              |  1 px leader, accent at 40%
   +----------+----------------------------+  radius 8, surface-raised,
   | l-inf ball of radius eps              |  1 px rule, shadow 0 8px 24px
   |                                       |  rgba(0,0,0,.45)
   | The set {x' : ||x'-x||_inf <= eps}.   |  phrase 17/24 600
   | Every coordinate may move by at most  |  body 14/21, measure <= 62ch
   | eps.                                  |
   |                                       |
   | In this course eps is the budget in   |  intuition paragraph, ink-muted
   | Lec 3's threat model, not a radius    |
   | in feature space.                     |
   |                                       |
   | slide 14   glossary          esc close|  meta 12 mono, ink-muted
   +---------------------------------------+
```

Review mode. Asymmetric two-column; the note rail has a fixed reading measure and
the slide takes the remainder.

```
+---------------------------------------------------------------+
| Trustworthy DL . Lec 09 Certified Defenses          14/62     |  36 px header
+----------------------------------+----------------------------+
|                                  |  notes                     |  rail 580 fixed
|      slide, fit to 890-48 wide   | |Randomized smoothing turns|  slide pane 890
|      canvas + anchor layer       |  any classifier into a ... |  text measure 526
|                                  |  --------------------------|  (~66ch), left
|      spans that carry note refs  | |The certified radius is   |  aligned
|      show a 1 px underline in    |  sigma * Phi^-1(p_A) ...   |
|      ink-muted at 35%            |  --------------------------|
|                                  | ||ask why Phi^-1 and not   |  student note:
|                                  | ||the Gaussian tail bound  |  2 px mine rule,
|                                  |  09:41                     |  italic, meta time
|                                  |----------------------------|
|                                  |  glossary            g     |  collapsible,
|                                  |  smoothing  Adds N(0,s^2I) |  max 40% rail h
|                                  |  p_A        Top-class prob |
+----------------------------------+----------------------------+
```

Note lines are flush-left with a 12 px gutter reserved for the provenance rule, so
generated and student notes share a text edge.

Library. Single left-aligned column, max-width 900, centered.

```
  Trustworthy Deep Learning                          12 lectures
  --------------------------------------------------------------
  09  Certified Defenses          Mar 04   ooo   62 slides
  08  Adversarial Training        Feb 27   ooo   54 slides
  07  Threat Models               Feb 25   oo.   48 slides   notes pending
  06  Calibration under Shift     Feb 20   o..   --          transcribing
  --------------------------------------------------------------
  rows 44 px, tabular-nums. Three pips = recorded, transcribed, notes.
  Filled = done, hollow = not yet. No colored badges or status pills.
```

## D. Keymap

Routing is one finite state machine: mode in {idle, numberEntry, noteInput,
cardOpen, palette}. Bare-letter shortcuts fire only in idle and cardOpen.
noteInput and palette swallow every printable key and intercept only Enter, Esc,
up, down. numberEntry accepts only digits, Backspace, Enter, Esc. The state check,
not an activeElement sniff, keeps `n` from being eaten mid-word. No Cmd+Arrow
binding exists anywhere.

| Key | Context | Action | Why |
|---|---|---|---|
| Right / Space / PageDown | lecture, review (idle) | Next slide | Bare, safe; PageDown matches clickers |
| Left / PageUp | lecture, review (idle) | Previous slide | Pair of the above |
| 0-9 | lecture, review (idle) | Enter numberEntry; digits echo in the strip | Digits are disjoint from letter shortcuts |
| Enter | numberEntry | Jump to that slide | Explicit commit, no timeout guessing |
| n | lecture, review (idle) | Open note input, enter noteInput | Mnemonic, far from arrows |
| Enter | noteInput | Commit note, collapse field, back to idle | |
| Esc | any | Pop one level: cancel note, clear digits, close card, close palette, clear term cursor | One universal back-out |
| e | idle, selection present | Explain selection: open lookup card | Mnemonic, no Chrome conflict |
| t / Shift+T | idle | Cycle a cursor through the slide's known term spans; `e` or Enter opens the card | Keyboard-only lookup fallback |
| Option+1/2/3 | global | Lecture / Review / Library | Alt combos are delivered and unclaimed |
| j / k | review (idle) | Focus next / previous note line; lines are tabindex=0 so Tab also works | vim, Zotero, Superhuman convention |
| g | review (idle) | Toggle glossary panel | Mnemonic |
| Cmd+K | global | Command palette, also the discovery surface for every key | Architect: verify on Chrome macOS; fallback Option+K |
| - / = | lecture (idle) | Dim / brighten the slide canvas | Adjacent, not digits |
| ? | global (idle) | Keymap overlay | Shift+/ with preventDefault; bare / is never bound |

## E. Highlight and anchor spec

Geometry: merge the text-layer bounding boxes per visual line, not per span; one
`div.anchor` per line of the reference, absolutely positioned in an `.anchor-layer`
sibling of the canvas sharing its transform. `padding: 1px 2px`,
`border-radius: 2px`. Do not use the CSS Custom Highlight API for these: it allows
only color, background, text-decoration and text-shadow, so no radius, border or
hit target. It is acceptable for the transient `t`-cycle preview.

Blending: `mix-blend-mode: multiply` in both themes because the substrate is the
professor's light PDF. On first render sample mean canvas luminance; if below 0.5
(a dark deck), switch that lecture to `screen` blending and on-dark fill tokens.

| State | Fill (light) | Fill (dark) | Other |
|---|---|---|---|
| Resting, has references | none | none | `border-bottom: 1px solid color-mix(in srgb, var(--ink-muted) 35%, transparent)` |
| Hover-linked | `rgba(233,162,59,.20)` | `rgba(233,162,59,.28)` | 90 ms tint fade |
| Active (card open or note row focused) | `rgba(233,162,59,.38)` | `rgba(233,162,59,.46)` | plus `box-shadow: inset 0 -1px 0 var(--accent)` |
| Student-note anchor | `rgba(95,179,196,.22)` | `rgba(95,179,196,.30)` | hover/active bump identically |
| Keyboard focus | none | none | `outline: 2px solid var(--accent); outline-offset: 2px` |

Multi-span references: all line boxes of one reference carry `data-ref` and change
state together; the first box gets top corners rounded, the last gets bottom
corners, intermediates square. The leader line attaches to the first box.
Reciprocity is symmetric and driven by one `hoveredRef` / `activeRef` pair in state.

## F. Component inventory

AppShell (theme plus mode FSM host); KeyRouter (single keydown listener,
mode-dispatched, the only place preventDefault is called); SlideStage (fit math,
dimmer); PdfPage (pdf.js canvas plus text layer); AnchorLayer (per-line boxes,
state classes); SelectionWatcher (selectionchange to text-layer span mapping);
StatusStrip; HeartbeatIndicator (reads the heartbeat file, renders elapsed
seconds, flips to stale past threshold); NoteCapture (single-line input, mounts on
`n`, unmounts on commit or cancel); LookupCard (anchored positioning, flip, leader
line); TermCursor (the `t` fallback); NoteRail plus NoteLine (roving focus,
provenance rule); GlossaryPanel; SlideNavigator (number entry buffer);
CommandPalette; LibraryList plus LectureRow plus StatusPips; ExportMenu
(secondary).

Architecture: CSS custom properties in one `:root` block, themed by
`[data-theme="dark"]` on html, CSS Modules per component. No Tailwind: the anchor
geometry, blend modes and per-line corner logic are computed CSS that fights
utility classes. No component library: the palette is a ~150-line filtered list in
a `dialog` with a focus trap. Runtime dependencies beyond React: pinned pdfjs-dist,
and KaTeX only if needed.

## G. Anti-patterns to reject in review

1. A scrim or centered modal that covers the slide during lecture.
2. Any binding on Cmd+L/D/F/P/S/R/brackets, bare `/`, or Cmd+Arrow; any handler
   that checks activeElement.tagName instead of the mode FSM.
3. Permanently tinted highlights on the resting slide, or restyling or inverting
   the professor's canvas.
4. A colored dot for the recorder heartbeat instead of elapsed time; a green or
   red pill anywhere.
5. All-caps eyebrow labels, middot-joined meta strings, arrows appended to buttons,
   numbered markers on things that are not sequences.
6. One border radius and one grey shadow applied uniformly to every panel.
7. Hover transitions on every row; more than one non-user-triggered animation;
   any motion that survives reduced-motion.
8. A runtime Google Fonts link, a CDN script, or any network fetch on the lecture
   path.
9. Per-span highlight boxes with visible seams; highlights built on `::highlight()`.
10. Focus indicated by a background swap rather than an outline; anything
    reachable by j/k but not Tab.
11. A live transcript, waveform, audio scrubber, or chat panel in lecture mode.
12. Generated and student text distinguished only by a color that fails 3:1.

Sources: Zotero keyboard shortcuts (zotero.org/support/kb/keyboard_shortcuts),
Readwise Ghostreader docs, Hypothesis client annotator source, alphaXiv comment
guidelines, Superhuman on command palettes, MDN CSS Custom Highlight API, MDN
mix-blend-mode, googlefonts/atkinson-hyperlegible-next and -mono (OFL 1.1),
KaTeX font docs.
