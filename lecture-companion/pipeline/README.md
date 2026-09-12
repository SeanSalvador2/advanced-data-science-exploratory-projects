# lecture-rec — recording and transcribing a lecture, locally

`lecture-rec` is the Python half of the lecture companion: it owns the
microphone and the transcription model. It records a lecture while the browser
app is open on the same folder, and afterwards turns the audio into
`transcript.json` with the slide deck's vocabulary fed to the recogniser.

Everything runs on your Mac. No cloud APIs. No API keys. Ever.

(The package began as the Phase 0 spike that measured whether local
transcription was accurate enough. It was; the measurement commands are still
here, at the end of this file.)

## Install

```bash
xcode-select --install                 # once per machine
cd lecture-companion/pipeline
uv sync --extra mlx                    # mlx = the fast Apple Silicon engine
uv run lecture-rec doctor
```

`--extra mlx` only installs on Apple Silicon. On anything else, `uv sync` alone
gives you faster-whisper, which works but is several times slower.

`lecture-rec doctor` prints your input devices, which engines are importable,
whether `.lecture/` (where the heartbeat goes) is writable, and runs a 3-second
microphone level test. **Do not skip it.** Give it the lecture folder if you
want it checked too: `uv run lecture-rec doctor ~/vault/Lectures/ml/w07`.

### Microphone permission (the thing that silently ruins recordings)

macOS grants microphone access to the **terminal application**, not to python.

1. Run `uv run lecture-rec doctor` from **Terminal.app** or **iTerm**, not from
   the terminal built into VS Code / Cursor / PyCharm. Editor terminals very
   often record perfect digital silence with no error message at all.
2. macOS pops a permission dialog the first time. Say yes.
3. Check it stuck: System Settings → Privacy & Security → Microphone → your
   terminal app is on and toggled blue.
4. Re-run `doctor`. The level meter must move when you talk. If it reads
   `rms 0.00000`, permission is the cause 90% of the time; the other 10% is the
   wrong input device or Zoom holding the mic.

Record from the same terminal app you tested in.

## Before the lecture

The lecture folder is prepared by `lecture prepare` (the Node CLI) and given its
vocabulary by `/lecture-terms` or `/lecture-bias-terms` in Claude Code, which
write `bias.json`. Without Claude Code there is a heuristic fallback here:

```bash
uv run lecture-rec terms <lecture-dir> --deck ~/Downloads/week7-slides.pdf
```

That writes `bias.json` (per-slide vocabulary) and `deck.txt`. Claude's version
of the same file is much better — it can turn `θ̂` into `theta hat` and `D_KL`
into `KL divergence`, which a regex cannot — and `lecture-rec` does not care
which produced it.

**Then do a 30-second test recording and play it back.** This is the single
highest-value five minutes of the week:

```bash
uv run lecture-rec record /tmp/testrec       # talk for 30 s, press q
afplay /tmp/testrec/audio.wav                # you must hear yourself clearly
rm -rf /tmp/testrec
```

If you cannot understand yourself on playback, the lecture recording will not
work either. Move the laptop, or buy a $30 lavalier mic.

## Lecture day

Two things running side by side on the same folder:

```bash
uv run lecture-rec record <lecture-dir>      # in Terminal.app
```

and the browser app, open on `<lecture-dir>`.

- **Start the recorder 2 minutes early.** Disk is cheap; a missed opening is not.
- The **app** marks slide changes and takes your notes. It appends them to
  `events.jsonl` with a wall-clock time; the recorder appends `start` and `stop`
  with both clocks, and `transcribe` puts everything on the audio clock later.
- The terminal is for one key only: **`q` stops**. Ctrl-C stops cleanly too.
  Enter does nothing on purpose.
- While recording, `.lecture/heartbeat.json` is rewritten every 2 seconds with
  the elapsed audio time and the recent input level, which is how the app can
  show "rec 43:12" and tell you if the mic has gone silent. It is deleted on a
  clean stop, so if it is still there and getting stale, the recorder died.
- **Do not close the lid.** `lecture-rec` starts `caffeinate`, so the Mac will
  not sleep on its own, but a closed lid sleeps it anyway.
- **Put Voice Memos on your phone as a backup**, on the desk, recording the
  whole time. It costs nothing and it has saved people.
- If the mic goes silent, `lecture-rec` shouts about it in red and keeps
  recording. It never stops on its own.

The WAV is flushed every few seconds, so even a dead battery leaves you with a
playable file of everything up to the last moment.

### If the recorder dies mid-lecture

Start it again in the same folder. It records a second take beside the first,
and the transcriber places both on one clock:

```bash
uv run lecture-rec record <lecture-dir>      # again, same folder
# audio.wav exists; recording take 2 to audio.take2.wav; the transcriber will
# stitch the takes
```

Take 1 keeps the names it always had (`audio.wav`, `recording.json`); take 2
lands beside it as `audio.take2.wav` with `recording.take2.json`, take 3 as
`audio.take3.wav`, and so on. **Nothing already recorded is ever opened for
writing, and no flag exists that would overwrite it** - to record a different
lecture, use a different folder.

Each take stamps its own `startedWall`, and take 1's is the zero of the
*lecture clock*. Take N's audio is placed `startedWall_N - startedWall_1`
seconds along that clock, so `transcribe <lecture-dir>` reads every take, writes
the usual single `transcript.json`, and the minutes you spent restarting are
simply silence in the middle with no segments. The app never has to know: it
keeps writing wall-clock slide and note events to the same `events.jsonl`, and
they land on the same one clock. The recorder's own events for take N carry
that offset too, so both agree.

The app's "rec 43:12" restarts from zero, because the heartbeat's `elapsedS` is
the current take's recording time (its `take` field says which take that is).
`lecture-rec doctor <lecture-dir>` lists the takes a folder already holds.

One thing does not survive a restart: `lecture-rec sample` refuses a folder with
more than one take, so the quality measurement at the end of this file wants a
lecture that was recorded in one go.

### Recording without the app

```bash
uv run lecture-rec record <lecture-dir> --keys
```

You mark the slides from the terminal instead, starting on slide 1:

- **Enter** — next slide. That is the whole job.
- `b` — went back a slide. `12` — jump to slide 12 (use this when you lose
  count; it resyncs everything from that point on).
- `n something worth remembering` — timestamped note.
- `q` — stop.

## After the lecture

```bash
uv run lecture-rec transcribe <lecture-dir>
```

Writes `<lecture-dir>/transcript.json` (and a readable `transcript.txt`), using
`bias.json` as the recogniser's prompt for each slide. Without a `bias.json` it
transcribes unbiased and says so.

Progress prints a real-time factor (rtf); **rtf 0.3 means a 75-minute lecture
takes about 25 minutes**, so budget roughly:

| engine | model | ~time for 75 min |
|---|---|---|
| mlx-whisper (Apple Silicon) | large-v3-turbo | 15–30 min |
| faster-whisper (CPU) | large-v3-turbo | 1.5–3 hours |
| faster-whisper (CPU) | small.en | 25–45 min |

Start it and go do something else. The JSON is rewritten after every slide, so
a crash loses minutes, not hours — `--resume` picks up where it stopped.

## The lecture folder

What this program reads and writes inside one lecture folder:

```
<lecture-dir>/
  deck.pdf  deck.txt          slides, and their extracted text
  bias.json                   per-slide vocabulary          (read)
  audio.wav                   16 kHz mono PCM16             (written by record)
  recording.json              RecordingMeta                 (written by record)
  audio.take2.wav             take 2, only if record was restarted here
  recording.take2.json        its RecordingMeta, with its own startedWall
  .lecture/heartbeat.json     Heartbeat, every 2 s          (written by record)
  events.jsonl                start/stop from record, slide/note from the app
  transcript.json  .txt       Transcript                    (written by transcribe)
```

Times in `events.jsonl` and `transcript.json` are on the lecture clock, which is
take 1's audio clock. On the usual single-take lecture that is just "seconds
into the recording", and every file is exactly what it was before takes existed:
`take` appears only from take 2 on, on the events, the recording metadata, the
heartbeat and the transcript's segments.

Every JSON file carries a `schema` field and is checked by the Node CLI:
`node ../cli/bin/lecture.mjs validate <lecture-dir>/transcript.json`.

## Troubleshooting

**`rms 0.00000` / "SILENT INPUT" in red.** Microphone permission, almost always.
See the permission section above. Run from Terminal.app, not an editor terminal.
Then: right input device (`doctor` marks the default with `*`), input volume not
at zero, and nothing else holding the mic (Zoom, Teams, Photo Booth).

**The app says "no recorder".** `.lecture/heartbeat.json` is missing: the
recorder is not running, or it is running on a different folder. `lecture-rec
doctor <lecture-dir>` prints the exact path it would write.

**First `transcribe` sits there doing nothing.** It is downloading the model
(large-v3-turbo is ~1.5 GB) from Hugging Face. It happens once, and it is cached
in `~/.cache/huggingface`. Do it on wifi you trust, before lecture day.

**`mlx-whisper` not found.** `uv sync --extra mlx`, and only on Apple Silicon.
Without it `lecture-rec` falls back to faster-whisper automatically — same
results, several times slower.

**Transcription is far too slow.** Use a smaller model: `--model small.en`
(faster-whisper) or `--model mlx-community/whisper-small.en-mlx` (mlx-whisper).

**Prompt text appears at the start of segments.** That is prompt echo.
`lecture-rec` strips it when it can (it logs `[prompt echo stripped]`), but if
it is everywhere, shorten the deck's per-page term lists.

**`bias.json has no terms`.** The PDF is a scan with no text layer. Use
`/lecture-bias-terms` in Claude Code instead — it can read the pages as images.

**`record` says "audio.wav exists; recording take 2".** That is the feature, not
an error: the folder already holds a recording, so this one goes beside it and
`transcribe` stitches them. If you meant a different lecture, stop and use a
different folder - nothing here overwrites audio.

**Some events were dropped.** `transcribe` names them. An event with no `t` and
no `recording.startedWall` to project its wall clock onto cannot be placed; an
event more than 5 s past the end of the audio belongs to another recording.

**No slides / no `events.jsonl`.** Everything still works; the whole file
becomes one segment and the global term list is used throughout.

## Trying it without a lecture

```bash
uv run python scripts/make_synthetic_lecture.py data/synthetic-app --app-events
uv run lecture-rec transcribe data/synthetic-app --engine faster-whisper --model tiny.en
```

For the restarted-recorder shape - take 1, a 20-second hole, take 2 with its own
`recording.take2.json`, and app slide events running across both:

```bash
uv run python scripts/make_synthetic_lecture.py data/two --two-takes
uv run lecture-rec transcribe data/two --engine faster-whisper --model tiny.en
```

Builds a fake lecture folder from a public-domain 11-second clip — recorder
`start`/`stop`, app-written slide events, camelCase `recording.json` — and
transcribes it in about a minute. Use it to check the tooling works before you
rely on it. Drop `--app-events` for a folder in the old Phase 0 shape, which
still transcribes.

`data/` is gitignored. Nothing in here is ever uploaded anywhere.

---

## Measuring transcription quality

The commands that answered "is a laptop mic in a lecture hall good enough, and
does feeding the deck's vocabulary to Whisper help?". Re-run them whenever the
capture setup changes — a new room, a new mic, a different model.

It measures two things, on three 5-minute windows you correct by hand:

1. **word error rate (WER)** against your corrected text;
2. **term recall** — of the technical terms that really were said, how many did
   the transcript spell right? Measured twice: plain, and biased with the deck's
   vocabulary.

```bash
uv run lecture-rec transcribe <lecture-dir> --eval
```

Runs twice over the same audio pieces — once plain, once biased — and writes
`transcripts/plain.json` and `transcripts/biased.json` (plus `.txt`) instead of
`transcript.json`. Budget twice the time of a normal run.

```bash
uv run lecture-rec sample <lecture-dir>
```

Cuts three 5-minute windows from 20%, 50% and 80% through the lecture into
`eval/window-1/`, `window-2/`, `window-3/`. Each holds `clip.wav`, `draft.txt`
(what the machine heard) and `reference.txt` (a copy of the draft, for you).

**Now the only manual work.** For each window: play `clip.wav` and fix
`reference.txt` until it is what was actually said. Fix real errors only — wrong
words, missing words, mangled terms. Do not restyle punctuation or tidy the
lecturer's grammar; that would inflate the error rate against a transcript that
was actually fine. Budget **30–45 minutes for all three**. Re-running `sample`
never overwrites a `reference.txt` you have edited. `sample` refuses a folder
with more than one take: measure on a lecture that was recorded in one go.

```bash
uv run lecture-rec score <lecture-dir>
```

Prints the report and writes `report.md`. The verdict is judged on the
**biased** condition's pooled numbers.

| verdict | when | what to do |
|---|---|---|
| **PROCEED** | WER < 15% and term recall ≥ 85% | The audio path works. Build on it. |
| **PROCEED ONLY AFTER RE-TEST WITH BETTER MIC** | WER 15–30%, or recall 60–85% | Usable but uncomfortable. Get the mic closer — a $30 lavalier, or sit in the front row — record one more lecture, re-measure. |
| **STOP: audio path not viable with this setup** | WER > 30%, or recall < 60% | Too many words are wrong for summarising or search to be trustworthy. Change the capture entirely: a dedicated recorder, a lapel mic, or the lecturer's own audio feed. |

The report also says whether the biasing was worth it, from the change in term
recall: **≥ +5 points** → keep it; **within ±5** → no measurable effect;
**≤ −5 points** → biasing is hurting, which almost always means prompt echo
(look for segments in `transcripts/biased.txt` that open with a run of
comma-separated terms).

A WER of 10–20% *sounds* bad and often reads fine — English is redundant. The
term recall number is the one that decides whether notes built on these
transcripts can be trusted.

On the synthetic lecture, end to end:

```bash
uv run python scripts/make_synthetic_lecture.py data/synthetic
uv run lecture-rec transcribe data/synthetic --eval --engine faster-whisper --model tiny.en
uv run lecture-rec sample data/synthetic --n 2 --window-s 30
uv run python scripts/make_synthetic_lecture.py data/synthetic --seed-references
uv run lecture-rec score data/synthetic
```

`--seed-references` fills in the known transcript so you do not have to
hand-correct anything, and the whole thing runs in about a minute.
