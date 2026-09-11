# Phase 2 — Research findings and recommended stack

Status: awaiting approval before Phase 3 (architecture).
Date: 2026-09-11. Every finding below was verified by a research subagent against
current primary sources (package source, specs, product docs) or measured
empirically; items that could not be verified are marked UNVERIFIED.

## 0. What changed since Phase 1

Your answers removed two features and changed the runtime model.

- No API keys. All LLM steps run as Claude Code skills inside this repo, on your
  subscription. Transcription runs locally on the MacBook Air. This is the
  better architecture for you anyway: nothing about a lecture leaves the laptop.
- Star and question-mark hotkeys are dropped. Typed notes plus
  highlight-to-explain are the lecture-time interaction.
- No audio playback in the review view for v1. Good transcription and good notes
  are the payoff.
- The app is the only foreground window during lecture. So Document
  Picture-in-Picture is not needed, and a Chrome tab is enough.
- Files live on disk in your Obsidian vault.

## 1. Phase 0 spike — built, tested, pushed

`lecture-companion/spike/` is a Python CLI (`uv run spike ...`) with six commands:
`doctor`, `record`, `terms`, `transcribe`, `sample`, `score`. It records the mic to a
16 kHz WAV with slide-change markers (Enter = next slide), transcribes the lecture
twice with the same audio pieces (plain, and biased with per-slide vocabulary from the
deck), cuts three 5-minute windows for you to hand-correct, and scores word error
rate and technical-term recall per condition with a PROCEED / RE-TEST / STOP verdict.
The runbook is `spike/README.md`. There is also a Claude Code skill,
`/lecture-bias-terms <dir>`, that writes a better per-slide vocabulary list than the
regex heuristic (it can turn `θ̂` into `theta hat`).

What I verified myself in this container: the full pipeline on a synthetic lecture
built from a public-domain clip (transcribe, sample, score, report), schema
conformance of every output, monotonic timestamps, and 123 unit tests. What I could
not verify here: the Apple Silicon engine path (mlx-whisper) and a real microphone,
because this container has neither. Both are exercised by `spike doctor` on your
machine before you record anything real.

Thresholds (judged on the biased transcript, pooled over the three windows):
WER under 15% and term recall at or above 85% means proceed. WER 15 to 30% means
proceed only after re-testing with a better microphone. WER over 30% or recall
under 60% means stop and rethink the audio path.

## 2. Transcription (local, Apple Silicon)

| Engine | Speed on M-series | Word timestamps | Vocabulary biasing | Verdict |
|---|---|---|---|---|
| mlx-whisper 0.4.3, large-v3-turbo | fastest Whisper path (RTF UNVERIFIED, roughly 5 to 15 min per hour) | yes | `initial_prompt`, first 30 s window only, no carry option | primary |
| faster-whisper 1.2.1 | CPU-only on Mac, about 7x slower than MLX | yes | `initial_prompt` and per-window `hotwords` | Linux-testable fallback |
| whisper.cpp / pywhispercpp | fast (Metal wheel) | yes | `--prompt --carry-initial-prompt` | not chosen for spike |
| parakeet-mlx (tdt-0.6b-v3) | very fast | yes | none | optional no-bias control arm |
| mlx-qwen3-asr 0.4.0 | fast (vendor claim) | yes | native `context=` hotwords | promising, unproven; later 30-minute test |

Facts that shaped the design:

- The Whisper prompt window is 223 tokens, roughly 60 to 70 words. Per-slide bias
  lists must be short and ranked.
- In mlx-whisper the prompt applies only to the first 30-second window of a call.
  So the pipeline splits each slide's audio into pieces of at most 28 seconds, cut at
  the quietest moment, and calls the engine once per piece with that slide's terms.
  Both arms use identical pieces. This is what the spike does.
- Event timestamps are offsets on the audio stream's own clock, not wall clock, so
  slide markers cannot drift from the audio.
- macOS grants microphone permission to the terminal app, not to Python. Editor
  terminals often record silence with no error. The recorder detects this and warns
  in red; the runbook tells you to record from Terminal.app or iTerm.

## 3. Prior art

Nothing ships the three pieces that make this project worth building:
sub-slide anchoring of note lines, precomputed course-specific term explanations,
or slide-conditioned transcription vocabulary.

- RemNote is the closest product. Slide-level linking in a split view, a cloud
  lecture recorder with word timestamps and click-to-seek, on the $18/month AI tier.
  Reader highlights carry an opaque backlink, not addressable span IDs.
- Otter's slide capture fires on screen share. In person you insert a manual
  screenshot. Its custom vocabulary is account-wide, not per slide.
- Notability, Goodnotes and OneNote anchor to time, not to slide content.
  NotebookLM has no microphone input. Apple Notes transcribes on device but has no
  PDF anchoring.
- The upload-a-recording layer (Mindgrasp, Knowt, ScreenApp, Turbolearn, Coconote)
  is cloud-only and deck-level at best.

Open source worth adopting:

- pdf.js text layer as the renderer and the source of span IDs.
- Hypothesis client's anchoring code (BSD-2) for quote-plus-position re-anchoring,
  if we ever need fuzzy re-anchoring across deck revisions.
- Hyperaudio Lite's per-word markup as the transcript rendering format.
- Obsidian's native PDF selection link,
  `[[deck.pdf#page=N&selection=beginIndex,beginOffset,endIndex,endOffset]]`, where
  the index is the pdf.js text item index. Our span IDs are that index, so the
  Markdown export becomes clickable in a stock vault.

Worth borrowing from: `drpwchen/lecture-to-notes` (MIT, Aug 2026), the closest
open-source sibling. Local faster-whisper, post-hoc slide alignment, a
`slides_grounded.json` schema, an Obsidian vault exporter, shipped as a Claude Code
skill plus CLI. It is slide-level, post-hoc and glossary-free, so our niche stands.

## 4. Browser feasibility (measured on pdfjs-dist 6.3.289)

- Text items are line fragments with a baseline transform, not words. A LaTeX page
  yields roughly 200 items; math comes through as real Unicode split into runs of
  one-character items. No private-use garbage was observed.
- Span ID contract: the index into the text layer's `textDivs` array, which equals
  the index into the string-bearing text items, empty strings included. Never the
  DOM child index. Extraction is byte-identical between Node and browser and across
  pdf.js 5.7 to 6.3 on the same file. Pin `pdfjs-dist@6.3.289` exactly in both the
  app and the Node CLI, keep `includeMarkedContent` false and `disableNormalization`
  false on both sides, and stamp the version into every record.
- `convertToViewportRectangle` was removed in pdf.js 6.2. Bounding boxes come from
  two `convertToViewportPoint` calls.
- Selection to span IDs: map each text div to its index, walk up from the range
  endpoints, handle line-break endpoints, backwards selections, and drags that start
  on the canvas. Listen to `selectionchange` debounced, since keyboard selection
  never fires mouseup.
- File System Access API: pick the vault folder once, store the handle in
  IndexedDB, and ask for "allow on every visit" (Chrome 122+). Writes only reach
  disk on close, and appending copies the whole file, so notes are buffered in
  memory and flushed on slide change, blur, tab hidden, or three seconds idle.
  Finished Markdown is written as a temp name then moved, so Obsidian's watcher
  never indexes a half-written file.
- A directory observer exists in Chrome 133+ for the recorder heartbeat file, with a
  polling fallback.
- Wake Lock is screen-only and `caffeinate` already covers sleep. Skipped.
- Document Picture-in-Picture does not float over another app's macOS fullscreen
  Space. Skipped for v1, and not needed given the app is your foreground window.
- Keys Chrome never delivers on macOS: Cmd+N, T, W, Q, M, H, backtick, Ctrl+Tab.
  Keys that fire but should not be stolen: Cmd+L, 1 to 9, D, F, P, S, R, brackets.
  Safe: bare arrows, PageUp and PageDown, Space, Enter, Esc, bare letters when no
  input has focus, Option plus letter. No key reaches an unfocused tab.
- Slide PDFs: Beamer excellent, PowerPoint good, Google Slides usable with poor
  item order, Keynote UNVERIFIED. Item order is never assumed to be reading order.
  You mentioned xlsx decks; if you meant pptx, export to PDF first. If you truly
  have spreadsheets as lecture material, that is out of scope for v1.

## 5. Tooling and connectors

- Context7 is connected to your account but toggled off for this chat. Research
  subagents verified against package source and specs by web fetch instead, which
  was sufficient. Enable it in this chat's connector settings if you want it used
  in Phase 4; it is a convenience, not a requirement.
- The frontend-design skill exists on this machine and was used for the UI proposal.
- Supabase, Vercel, Hugging Face, Canva, Drive, Gmail, Calendar, Granola, PubMed,
  PDF Viewer: none are justified. Local-first means no hosting and no database.
  Hugging Face model downloads happen through the transcription libraries directly.
  I recommend no persistence or hosting layer at all.

## 6. Recommended stack

Plain-language version: three small programs that talk through files in one
folder per lecture. Python records and transcribes. Claude Code, via skills in this
repo, does the thinking (term index, notes). A Chrome page is the thing you look at
in lecture and afterwards. Each runs where it is best, and the files are the
contract, so any one of them can be replaced without touching the others.

Technical version:

| Layer | Choice | Why |
|---|---|---|
| Lecture folder | `<vault>/Lectures/<course>/<lecture-id>/` with `deck.pdf`, `audio.wav`, `events.jsonl`, `spans.json`, `terms.json`, `transcript.json`, `notes.json`, `<lecture-id>.md` | Files are the contract between the three programs; Obsidian indexes the Markdown |
| Recorder and transcriber | Python, `uv`, the spike's package promoted to `lecture-companion/pipeline/` | Robust mic capture, `caffeinate`, mlx-whisper; already built and tested |
| Span extraction | Node CLI on `pdfjs-dist@6.3.289` legacy build, shared module with the app | Identical span IDs offline and in the browser |
| LLM steps | Claude Code skills in `.claude/skills/`: `lecture-bias-terms` (exists), `lecture-terms` (term index from slide images plus spans), `lecture-notes` (per-slide notes with span tags) | No API keys; runs on your subscription; slide images give the model the notation the text layer mangles |
| App | Vite, TypeScript, React, CSS variables, no component library, pinned pdf.js | Best-documented target for implementation subagents; small; keyboard-first is easier without a UI kit fighting you |
| Storage | File System Access API on the lecture folder; buffered JSONL flushes; temp-then-move for Markdown | Durable, Obsidian-compatible, survives the app dying |
| Export | Markdown, one file per lecture, slide-numbered headers, Obsidian PDF selection links | Greppable, durable, clickable in a stock vault |

What I am recommending against: Electron or Tauri (no need; the browser does
everything v1 requires), any server, any database, a component library, Tailwind,
Google Docs, and streaming transcription.

## 7. UI direction

(Filled from the UI research; see section below.)

## 8. Open questions for you

1. Course folder layout in your vault: do you want `Lectures/<course>/<date>/`, or do
   you already have a structure I should match?
2. Deck format confirmation: PDF always? If some professors post pptx, I will add a
   one-line conversion step to the runbook.
3. Are you willing to run three commands on lecture day (`spike record` in a
   terminal, open the app, pick the folder), or do you want the app to launch the
   recorder for you? The second requires a tiny local helper process and I would
   defer it.
