# Lecture companion

A recorder, a slide viewer and a set of Claude Code skills that turn one
lecture into one folder of files you own. It records the room while you follow
the deck in a browser, transcribes the audio on your own machine with the
deck's vocabulary fed to the recogniser, and afterwards writes the notes you
would have written if you had not been busy listening. Nothing leaves your
laptop, there are no API keys, and every artefact is plain JSON or Markdown in
a folder your other tools can read.

## Three programs, one folder

Each piece runs where it is best. Python owns the microphone and the
transcription model. Claude Code owns the judgment. Node owns the
deterministic PDF work. The browser is a viewer and a note pad. They share
nothing but files, so any one of them can be re-run, or rewritten, on its own.

```
                    night before            lecture day             after
  lecture (Node)    prepare ─┐               │                  ┌─ export-md
                             ▼               │                  │
  Claude Code      /lecture-terms            │             /lecture-notes
                             │               │                  ▲
                             ▼               ▼                  │
  lecture-rec (py)         bias           record ──────────► transcribe
                                             ▲
  the app (Chrome)                    lecture mode            review mode

  <vault>/Lectures/<course>/<lecture-id>/
    lecture.json   deck.pdf   spans.json   pages/p001.png …   prepare
    terms.json                                                /lecture-terms
    bias.json                                                 bias
    audio.wav   recording.json   .lecture/heartbeat.json      record
    events.jsonl                        slides and notes from the app, and
                                        start/stop from the recorder
    transcript.json                                           transcribe
    notes.json                                                /lecture-notes
    <lecture-id>.md                                           export-md
```

Every JSON file names its own schema and `lecture validate <file>` checks it.
The app only ever writes `events.jsonl`.

## Install, on a Mac

```bash
brew install node uv ffmpeg
brew install --cask google-chrome
xcode-select --install

git clone <this repo> && cd <this repo>/lecture-companion
npm install
npm run build
cd pipeline && uv sync --extra mlx && cd ..
```

`--extra mlx` is the fast Apple Silicon transcription engine; on an Intel Mac
drop it and `uv sync` alone gives you the slower CPU engine. `npm install`
leaves the `lecture` command at `node_modules/.bin/lecture`, so put that
directory on your PATH:

```bash
echo "export PATH=\"$PWD/node_modules/.bin:\$PATH\"" >> ~/.zshrc && exec zsh
```

Then prove the whole thing works before you rely on it:

```bash
npm run dry-run
```

That builds everything, walks a fixture lecture through every step, runs a
real transcription over real audio, validates every file it produced, and
prints three commands that open the result in Chrome. If it exits 0, you are
installed. Two things it cannot check for you — macOS microphone permission
and Chrome's folder permission — are the first section of
[docs/runbook.md](docs/runbook.md). Do those next.

## The week, in seven commands

`DIR` is one lecture folder, for example
`~/vault/Lectures/TDL/2026-09-15-lec05`. The two slash commands are typed into
Claude Code, started from the root of this repository so it can see
`.claude/skills/`.

```bash
lecture prepare "$DIR" --deck ~/Downloads/lec05.pdf --course TDL   # night before
/lecture-terms "$DIR"                                              # in Claude Code
lecture bias "$DIR"
(cd pipeline && uv run lecture-rec record "$DIR")                  # lecture day
(cd pipeline && uv run lecture-rec transcribe "$DIR")              # after
/lecture-notes "$DIR"                                              # in Claude Code
lecture export-md "$DIR"
```

Lost? `lecture status "$DIR"` prints what the folder holds and, on its last
line, the one command to run next.

## Where things live

| | |
|---|---|
| `cli/` | the `lecture` command: prepare, bias, merge, export, validate, status |
| `pipeline/` | the `lecture-rec` command: record, transcribe, and the quality measurement — [README](pipeline/README.md) |
| `app/` | the Chrome page for lecture and review mode — [README](app/README.md) |
| `packages/core/` | the schemas, the span maths, the lookup ranking, the exporter |
| `../.claude/skills/` | `/lecture-terms`, `/lecture-notes`, `/lecture-bias-terms` |
| `scripts/dry-run.sh` | the end-to-end smoke test behind `npm run dry-run` |

## Documents

- [docs/runbook.md](docs/runbook.md) — what to do, in order, on a real week,
  and what to do when something goes wrong. Start here.
- [docs/architecture.md](docs/architecture.md) — why it is split this way, and
  every data contract in full.
- [docs/ui-direction.md](docs/ui-direction.md) — the visual and keyboard
  specification the app is built to.
