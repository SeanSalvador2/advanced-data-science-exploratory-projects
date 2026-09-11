# spike — is local lecture transcription good enough?

A one-week experiment, not a product. Record one real lecture, transcribe it
locally two ways, and get a number that says whether to build the rest of the
lecture companion on this audio path.

Everything runs on your Mac. No cloud APIs. No API keys. Ever.

## What this answers

1. **Is a laptop mic in a lecture hall good enough?** Measured as word error rate
   (WER) against three 5-minute windows you correct by hand.
2. **Does feeding Whisper the slide deck's vocabulary help?** Measured as *term
   recall*: of the technical terms that really were said, how many did the
   transcript spell right? Measured twice — plain, and biased with terms pulled
   from the deck.
3. **Should you keep going?** One of three verdicts: PROCEED, re-test with a
   better mic, or stop.

## Install on the Mac

```bash
xcode-select --install                 # once per machine, if you have never built anything
brew install ffmpeg                    # spike does not need it, but everything else does
cd lecture-companion/spike
uv sync --extra mlx                    # mlx = the fast Apple Silicon engine
uv run spike doctor
```

`--extra mlx` only installs on Apple Silicon. On anything else, `uv sync` alone
gives you faster-whisper, which works but is several times slower.

`spike doctor` prints your input devices, which engines are importable, whether
ffmpeg is on PATH, and runs a 3-second microphone level test. **Do not skip it.**

### Microphone permission (the thing that silently ruins recordings)

macOS grants microphone access to the **terminal application**, not to python.

1. Run `uv run spike doctor` from **Terminal.app** or **iTerm**, not from the
   terminal built into VS Code / Cursor / PyCharm. Editor terminals very often
   record perfect digital silence with no error message at all.
2. macOS pops a permission dialog the first time. Say yes.
3. Check it stuck: System Settings → Privacy & Security → Microphone → your
   terminal app is on and toggled blue.
4. Re-run `spike doctor`. The level meter must move when you talk. If it reads
   `rms 0.00000`, permission is the cause 90% of the time; the other 10% is the
   wrong input device or Zoom holding the mic.

Record from the same terminal app you tested in.

## Before the lecture

```bash
mkdir -p data/lec01
uv run spike terms --dir data/lec01 --deck ~/Downloads/week7-slides.pdf
```

That writes `data/lec01/bias.json` (per-slide vocabulary) and `deck.txt`.

Better, if you have Claude Code open, run:

```
/lecture-bias-terms data/lec01
```

Claude reads the deck and writes a much better `bias.json` — it can turn `θ̂` into
`theta hat` and `D_KL` into `KL divergence`, which a regex cannot. Either way you
end up with the same file, and `spike` does not care which produced it.

**Then do a 30-second test recording and play it back.** This is the single
highest-value five minutes of the week:

```bash
uv run spike record --dir data/testrec       # talk for 30 s, press q
afplay data/testrec/audio.wav                # you must hear yourself clearly
rm -rf data/testrec
```

If you cannot understand yourself on playback, the lecture recording will not
work either. Move the laptop, or buy a $30 lavalier mic.

## During the lecture

```bash
uv run spike record --dir data/lec01 --deck ~/Downloads/week7-slides.pdf
```

- **Start 2 minutes early.** Disk is cheap; a missed opening is not.
- You start on **slide 1**. Press **Enter every time the slide changes**. That is
  the whole job. The slide markers are what let the transcriber feed the right
  vocabulary to the right minute of audio.
- `b` — went back a slide. `12` — jump to slide 12 (use this when you lose count;
  it resyncs everything from that point on).
- `n something worth remembering` — timestamped note. Good for "this will be on
  the exam" and "I did not follow this bit".
- `q` — stop. Ctrl-C also stops cleanly and keeps everything.
- **Do not close the lid.** `spike` starts `caffeinate` so the Mac will not sleep
  on its own, but a closed lid sleeps it anyway.
- **Put Voice Memos on your phone as a backup**, on the desk, recording the whole
  time. It costs nothing and it has saved people.
- If the mic goes silent, `spike` shouts about it in red and keeps recording. It
  never stops on its own.

The WAV is flushed every few seconds, so even a dead battery leaves you with a
playable file of everything up to the last moment.

## After the lecture

```bash
uv run spike transcribe --dir data/lec01
```

Runs twice over the same audio pieces: once plain, once with the deck vocabulary
as a prompt. Progress prints a real-time factor (rtf); **rtf 0.3 means a
75-minute lecture takes about 25 minutes per condition**, so budget roughly:

| engine | model | ~time for 75 min, both conditions |
|---|---|---|
| mlx-whisper (Apple Silicon) | large-v3-turbo | 30–60 min |
| faster-whisper (CPU) | large-v3-turbo | 3–6 hours |
| faster-whisper (CPU) | small.en | 45–90 min |

Start it and go do something else. The transcript JSON is rewritten after every
slide, so a crash loses minutes, not hours — `--resume` picks up where it stopped.

```bash
uv run spike sample --dir data/lec01
```

Cuts three 5-minute windows from 20%, 50% and 80% through the lecture into
`eval/window-1/`, `window-2/`, `window-3/`. Each holds `clip.wav`, `draft.txt`
(what the machine heard) and `reference.txt` (a copy of the draft, for you).

**Now the only manual work in the whole spike.** For each window: play `clip.wav`
and fix `reference.txt` until it is what was actually said. Fix real errors only —
wrong words, missing words, mangled terms. Do not restyle punctuation or tidy the
lecturer's grammar; that would inflate the error rate against a transcript that
was actually fine. Budget **30–45 minutes for all three**.

Re-running `spike sample` will never overwrite a `reference.txt` you have edited.

```bash
uv run spike score --dir data/lec01
```

Prints the report and writes `report.md`.

## Reading the verdict

The verdict is judged on the **biased** condition's pooled numbers.

| verdict | when | what to do |
|---|---|---|
| **PROCEED** | WER < 15% and term recall ≥ 85% | The audio path works. Build on it. |
| **PROCEED ONLY AFTER RE-TEST WITH BETTER MIC** | WER 15–30%, or recall 60–85% | Usable but uncomfortable. Get the mic closer — a $30 lavalier, or sit in the front row — record one more lecture, re-run the spike. Do not build on this yet. |
| **STOP: audio path not viable with this setup** | WER > 30%, or recall < 60% | Too many words are wrong for summarising or search to be trustworthy. Change the capture entirely: a dedicated recorder, a lapel mic, or ask for the lecturer's own audio feed. |

The report also says whether the biasing was worth it, from the change in term
recall: **≥ +5 points** → keep it; **within ±5** → no measurable effect, drop the
complexity; **≤ −5 points** → biasing is hurting, which almost always means prompt
echo (look for segments in `transcripts/biased.txt` that open with a run of
comma-separated terms).

A WER of 10–20% *sounds* bad and often reads fine — English is redundant. The
term recall number is the one that decides whether a lecture companion built on
these transcripts can be trusted.

## Troubleshooting

**`rms 0.00000` / "SILENT INPUT" in red.** Microphone permission, almost always.
See the permission section above. Run from Terminal.app, not an editor terminal.
Then: right input device (`spike doctor` marks the default with `*`), input volume
not at zero, and nothing else holding the mic (Zoom, Teams, Photo Booth).

**First `transcribe` sits there doing nothing.** It is downloading the model
(large-v3-turbo is ~1.5 GB) from Hugging Face. It happens once, and it is cached
in `~/.cache/huggingface`. Do it on wifi you trust, before lecture day.

**`mlx-whisper` not found.** `uv sync --extra mlx`, and only on Apple Silicon.
Without it `spike` falls back to faster-whisper automatically — same results,
several times slower. Check with `uv run spike doctor`.

**Transcription is far too slow.** Use a smaller model:
`--model small.en` (faster-whisper) or
`--model mlx-community/whisper-small.en-mlx` (mlx-whisper). Accuracy drops, so
re-run the spike with the model you actually intend to ship.

**Prompt text appears at the start of segments.** That is prompt echo. `spike`
strips it when it can (it logs `[prompt echo stripped]`), but if it is everywhere,
shorten the deck's per-page term lists.

**`bias.json has no terms`.** The PDF is a scan with no text layer. Use
`/lecture-bias-terms` in Claude Code instead — it can read the pages as images.

**No slides / no `events.jsonl`.** Everything still works; the whole file becomes
one segment and the global term list is used throughout.

## Trying it without a lecture

```bash
uv run python scripts/make_synthetic_lecture.py data/synthetic
uv run spike transcribe --dir data/synthetic --engine faster-whisper --model tiny.en
uv run spike sample --dir data/synthetic --n 2 --window-s 30
uv run python scripts/make_synthetic_lecture.py data/synthetic --seed-references
uv run spike score --dir data/synthetic
```

Builds a fake lecture from a public-domain 11-second clip, runs the whole
pipeline in about a minute, and (thanks to `--seed-references`, which fills in the
known transcript so you do not have to hand-correct anything) prints a real
report. Use it to check the tooling works before you rely on it.

## Layout of a lecture directory

```
data/lec01/
  deck.pdf  deck.txt          slides, and their extracted text
  audio.wav                   16 kHz mono PCM16
  recording.json              when it started, how long it ran
  events.jsonl                one line per slide change / note
  bias.json                   per-slide vocabulary
  transcripts/plain.{json,txt}
  transcripts/biased.{json,txt}
  eval/window-{1,2,3}/        clip.wav, draft.txt, reference.txt, meta.json
  report.md                   the verdict
```

`data/` is gitignored. Nothing in here is ever uploaded anywhere.
