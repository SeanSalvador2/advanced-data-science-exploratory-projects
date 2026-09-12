# Runbook

What to do, in order, on a real week. Install first: see the
[README](../README.md). `DIR` below is one lecture folder, for example
`~/vault/Lectures/TDL/2026-09-15-lec05`. Commands starting with `/` are typed
into Claude Code, started from the root of this repository.

## One-time setup

Do this once per machine, before the first lecture you care about.

### 1. Microphone permission

macOS grants microphone access to the **terminal application**, not to Python.
Get this wrong and you record a perfect, silent, hour-long WAV with no error
message at all.

1. Open **Terminal.app** or iTerm. Not the terminal inside VS Code, Cursor or
   PyCharm — those very often record digital silence.
2. Run the check:

   ```bash
   cd lecture-companion/pipeline && uv run lecture-rec doctor
   ```

3. macOS pops a permission dialog the first time. Say yes.
4. Confirm it stuck: System Settings → Privacy & Security → Microphone → your
   terminal app is listed and toggled on.
5. Run `doctor` again. The level meter must move when you talk. If it reads
   `rms 0.00000`, it is permission nine times out of ten; the rest is the wrong
   input device or Zoom holding the microphone.

Record from the same terminal application you tested in, every time.

### 2. The vault folder, in Chrome

The app reads your lectures through the File System Access API, which means you
grant it a folder by hand.

1. Start the app:

   ```bash
   cd lecture-companion && npm run dev --workspace @lecture/app
   ```

2. Open <http://localhost:5175> in Chrome and press **Choose your lectures
   folder**. Point it at the folder whose children are course folders — the one
   whose grandchildren look like `TDL/2026-09-15-lec05/lecture.json`.
3. Chrome asks whether to allow access. Choose **Allow on every visit**. If you
   choose "Allow this time" you will be asked again on every launch, in the
   dark, at the start of a lecture.
4. Close the tab and reopen it. You should land straight on the library. If
   Chrome asks again, the screen offers one **Reopen vault** button — that is
   Chrome's rule, not a bug: the permission can only be re-granted from a
   click.

### 3. A test recording

Five minutes, and the highest-value five minutes of the week.

```bash
cd lecture-companion/pipeline
uv run lecture-rec record /tmp/testrec     # talk for 30 seconds, press q
afplay /tmp/testrec/audio.wav              # you must understand yourself
rm -rf /tmp/testrec
```

If you cannot understand yourself on playback, the lecture will not transcribe
either. Move the laptop, sit further forward, or buy a $30 lavalier microphone.

## The night before

```bash
lecture prepare "$DIR" --deck ~/Downloads/lec05.pdf --course TDL
/lecture-terms "$DIR"
lecture bias "$DIR"
```

1. **Download the deck.** Save the PDF anywhere; `prepare` copies it in as
   `deck.pdf` and never touches your original.
2. **`lecture prepare`** creates the folder, extracts the text spans and
   renders every page to a PNG. Add `--number 5 --title "Certified Defenses"`
   if you know them, and `--prior 2026-09-08-lec04` so the term index stays
   consistent with last week's.
3. **`/lecture-terms`** is the slow, careful step: it reads every slide as an
   image and writes `terms.json` — what each term means, what the notation
   says, and how this course uses it. On a 60-page deck it works in batches and
   can be resumed. This is what the lookup card shows you in class.
4. **`lecture bias`** derives `bias.json` from it: the spellings the recogniser
   should prefer while each slide is up. Deterministic, one second.
5. **Do a 30-second test recording**, as above. Every week. Rooms change.

If the deck has not been posted yet, skip to "a deck posted late" below.

## Lecture day

Two things, side by side, on the same folder.

**Terminal.app** — the recorder:

```bash
cd lecture-companion/pipeline && uv run lecture-rec record "$DIR"
```

Start it **two minutes early**. Disk is cheap; a missed opening is not.

**Chrome** — the app. Open <http://localhost:5175>, press Enter on the lecture
in the library. It opens in lecture mode: the slide, and a 28 px strip under
it. Nothing else.

The keys you will actually use:

| Key | What it does |
|---|---|
| Left and Right | Move a slide. Space and PageDown work too, for a clicker. |
| `n` | Type a note. Enter files it against this slide and this second. |
| `e` | Explain the phrase you just highlighted with the mouse. |
| `t` | Step through this slide's terms without touching the mouse. |
| Esc | Back out one level: cancel the note, close the card. |
| `?` | Every key there is. Cmd+K opens the command palette. |

The strip, left to right: the page you are on, the recorder's elapsed time,
how many notes you have taken, and the mode. **Watch the recorder clock.** If
it says `no recorder`, the recorder is not running or is running on a different
folder. If it goes red and stale, the recorder died and you should restart it —
what it has already written is safe.

- **Do not close the lid.** The recorder holds the Mac awake with `caffeinate`,
  but a closed lid sleeps it anyway.
- **Put your phone on the desk recording to Voice Memos.** It costs nothing and
  it has saved people.
- To stop: press **`q`** in the terminal. Enter does nothing, on purpose.

## After the lecture

```bash
cd lecture-companion/pipeline && uv run lecture-rec transcribe "$DIR"
/lecture-notes "$DIR"
lecture export-md "$DIR"
```

1. **`transcribe`** rewrites the audio into `transcript.json`, feeding each
   slide's vocabulary to the recogniser as it goes. It prints a real-time
   factor: `rtf 0.3` means a 75-minute lecture takes about 25 minutes. Start it
   and go and do something else; `--resume` picks up where a crash left off.
2. **`/lecture-notes`** writes the unwritten layer — what was said that is not
   on the slide — anchored to the lines it is about and the seconds it was
   said, with your own typed notes kept verbatim and any questions you asked
   answered from the transcript where the professor answered them.
3. **`lecture export-md`** renders `<lecture-id>.md`: one file, one section per
   slide, with Obsidian links back into the deck.
4. **Open review mode** in the app. The slide on the left, the notes on the
   right; hovering either one lights the other. `g` opens the glossary, `]`
   and `[` skip to the next slide that has notes, and `o` hands the Markdown
   to Obsidian.
5. **Open it in Obsidian** if that is where your notes live. The Markdown is
   already in your vault; nothing needs importing.

## Measuring transcription quality

Do this once, on your first real lecture, and again whenever the room, the
microphone or the model changes. It answers "can I trust notes built on these
transcripts?" with a number instead of a feeling.

```bash
cd lecture-companion/pipeline
uv run lecture-rec transcribe "$DIR" --eval     # twice: plain and biased
uv run lecture-rec sample "$DIR"                # three 5-minute windows
# now hand-correct eval/window-*/reference.txt — 30 to 45 minutes, once
uv run lecture-rec score "$DIR"
```

`score` prints word error rate and term recall and a verdict. Word error rate
under 15% with term recall at or above 85% means proceed. Above 30% error, or
under 60% recall, means the audio path is not viable as it stands and the fix
is the microphone, not the software. The full table, and what the change in
term recall says about whether biasing is helping, is at the end of
[pipeline/README.md](../pipeline/README.md).

## When something goes wrong

**Silent microphone — `rms 0.00000`, or "SILENT INPUT" in red.** Permission,
almost always: see One-time setup. Then check the input device (`doctor` marks
the default), that input volume is not zero, and that Zoom or Teams is not
holding the microphone. The recorder shouts and keeps recording; it never stops
on its own.

**The app says `no recorder`.** `.lecture/heartbeat.json` is missing, so the
recorder is not running, or is running on a different folder. `uv run
lecture-rec doctor "$DIR"` prints the exact path it would write.

**The recorder clock has gone stale and red.** The heartbeat file is there but
has not been updated for six seconds: the recorder process died. Everything up
to that moment is already on disk. Start it again in the same folder; it
records a second take beside the first, and the transcriber places both on one
clock.

**The strip says `no term index`.** There is no `terms.json`, so `e` has
nothing to explain and shows the page summary at most. Run `/lecture-terms`
when you get home; the recording and your notes are unaffected.

**Chrome asks for the folder again.** Press **Reopen vault** and choose **Allow
on every visit**. The permission cannot be restored without a click, so there
is no way to make this silent.

**The deck was posted late, or not at all.** Record anyway, and mark the slides
from the terminal:

```bash
cd lecture-companion/pipeline && uv run lecture-rec record "$DIR" --keys
```

Enter is the next slide, `b` goes back one, a number jumps to that slide (use
it whenever you lose count — it resyncs everything after it), `n some text`
leaves a note, `q` stops. Afterwards run `lecture prepare` on the deck as
usual; the slide numbers the recorder wrote already line up with it, and
`/lecture-terms`, `transcribe` and `/lecture-notes` then run normally.

**`transcribe` sits there doing nothing on its first run.** It is downloading
the model, once, into `~/.cache/huggingface`. Do it on wifi you trust, before
lecture day.

**Anything else.** `lecture status "$DIR"` lists every file the folder should
hold, says which are there, and ends with the one command to run next.
