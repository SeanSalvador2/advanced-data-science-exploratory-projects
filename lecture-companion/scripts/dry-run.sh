#!/usr/bin/env bash
#
# The whole system, end to end, on the fixtures, from a clean checkout.
#
# It builds the three programs, walks one lecture folder through every step of
# the week using the deck and the skill outputs that ship as test fixtures,
# records-and-transcribes the pipeline's own synthetic lecture (the only step
# no fixture can stand in for, because it has to run a real recogniser over
# real audio), validates every JSON file both folders end up holding, and then
# prints the commands that open the result in the app.
#
# Everything it writes lives under lecture-companion/.dry-run/, which is
# gitignored and deleted at the start of each run. Nothing outside it is
# touched.
#
#   npm run dry-run        # from lecture-companion/
#
# Exit status is 0 only if every step succeeded.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DRY="$ROOT/.dry-run"
VAULT="$DRY/Lectures"
LECTURE="$VAULT/TDL/2026-09-15-lec05"
SYNTHETIC="$DRY/synthetic"
CLI="$ROOT/cli/bin/lecture.mjs"
DECK="$ROOT/packages/core/test/fixtures/html-slides.pdf"
FIXTURE="$ROOT/cli/test/fixtures/notes-lecture"

STEP="startup"
trap 'status=$?; if [ "$status" -ne 0 ]; then printf "\ndry-run FAILED during: %s (exit %d)\n" "$STEP" "$status" >&2; fi' EXIT

step() {
  STEP="$1"
  printf "\n=== %s\n" "$1"
}

lecture() {
  node "$CLI" "$@"
}

step "build the three programs"
cd "$ROOT"
npm install
npm run build

step "a clean .dry-run/"
rm -rf "$DRY"
mkdir -p "$VAULT/TDL" "$SYNTHETIC"

step "lecture prepare — the deck becomes a lecture folder"
lecture prepare "$LECTURE" \
  --deck "$DECK" \
  --course TDL \
  --id 2026-09-15-lec05 \
  --date 2026-09-15 \
  --number 5 \
  --title "Certified Defenses"

step "the skill and recorder outputs (fixtures, standing in for a real week)"
# terms.json is what /lecture-terms writes; the other four are what the
# recorder, the transcriber and /lecture-notes leave behind. They are copied
# rather than produced because producing them needs a Claude Code session and a
# lecture hall; every step that is pure code below is really run.
for file in terms.json recording.json events.jsonl transcript.json notes.json; do
  cp "$FIXTURE/$file" "$LECTURE/$file"
  echo "  copied $file"
done

step "lecture bias — the recogniser's vocabulary, derived from terms.json"
lecture bias "$LECTURE"

step "make_synthetic_lecture.py — audio, events and a recording to transcribe"
cd "$ROOT/pipeline"
uv run python scripts/make_synthetic_lecture.py "$SYNTHETIC" --app-events

step "lecture-rec transcribe — a real recogniser over real audio"
# tiny.en on the CPU engine, because this is a smoke test and not a lecture:
# about a minute, and the first run downloads the model.
uv run lecture-rec transcribe "$SYNTHETIC" --engine faster-whisper --model tiny.en
cd "$ROOT"

step "lecture export-md — notes.json and terms.json become Markdown"
lecture export-md "$LECTURE"

step "lecture validate — every JSON file in both folders"
found=0
while IFS= read -r file; do
  lecture validate "$file"
  found=$((found + 1))
done < <(find "$LECTURE" "$SYNTHETIC" -type f -name '*.json' | sort)
if [ "$found" -eq 0 ]; then
  echo "no JSON files were found to validate" >&2
  exit 1
fi
echo "  $found file(s) valid"

step "lecture status — where each folder stands, and what comes next"
lecture status "$LECTURE"
echo
lecture status "$SYNTHETIC"

STEP="done"
cat <<EOF

=== dry run complete

Everything above ran. To look at the result, in three commands:

  cd $ROOT/app
  LECTURE_DEV_ROOT=$VAULT npm run dev
  open 'http://localhost:5175/?dev#/review/TDL/2026-09-15-lec05'

The third one opens Chrome on the lecture you just built, in review mode,
through the dev storage adapter. Press ? for the keys and Cmd+K for the
command palette. Everything under $DRY can be deleted at any time.
EOF
