# Fonts

Atkinson Hyperlegible Next and Atkinson Hyperlegible Mono, drawn by the Braille
Institute for legibility under low contrast (ui-direction.md §A). They are
vendored here, served from the app's own origin, and never fetched from a
network: a Google Fonts link or any other CDN request on the lecture path is
anti-pattern 8.

## What is here, and where it came from

| File | Upstream name | Bytes |
|---|---|---|
| `atkinson-hyperlegible-next/atkinson-hyperlegible-next-var.woff2` | `fonts/webfonts/AtkinsonHyperlegibleNext[wght].woff2` | 48,188 |
| `atkinson-hyperlegible-next/atkinson-hyperlegible-next-italic-var.woff2` | `fonts/webfonts/AtkinsonHyperlegibleNext-Italic[wght].woff2` | 52,692 |
| `atkinson-hyperlegible-mono/atkinson-hyperlegible-mono-var.woff2` | `fonts/webfonts/AtkinsonHyperlegibleMono[wght].woff2` | 25,600 |

Sources, at the commit each file was taken from:

- <https://github.com/googlefonts/atkinson-hyperlegible-next> at
  `7925f50f649b3813257faf2f4c0b381011f434f1`
- <https://github.com/googlefonts/atkinson-hyperlegible-next-mono> at
  `154d50362016cc3e873eb21d242cd0772384c8f9`

Each family's `OFL.txt` is the license file from its own repository, copied
next to that family's fonts. Both are SIL Open Font License 1.1.

To re-fetch a file, ask `raw.githubusercontent.com` for the same path at the
same commit, for example:

```
curl -o atkinson-hyperlegible-next/atkinson-hyperlegible-next-var.woff2 \
  'https://raw.githubusercontent.com/googlefonts/atkinson-hyperlegible-next/7925f50f649b3813257faf2f4c0b381011f434f1/fonts/webfonts/AtkinsonHyperlegibleNext%5Bwght%5D.woff2'
```

The only change made to the upstream files is the name: the square brackets in
`AtkinsonHyperlegibleNext[wght].woff2` have to be percent-encoded in a URL, and
a font that fails to load because of an encoding difference between the dev
server and the built output is exactly the kind of silent breakage this project
does not want. The bytes are untouched — the sha256 of each file matches the
upstream blob.

## Why these three files, unsubset

All three are **variable** fonts with a `wght` axis from 200 to 800, so one
file covers every weight `tokens.css` asks for (400 body, 500 caption, 600
headings and glossary terms) with no synthetic bolding. The roman and the
italic of the UI face are separate files because review mode sets student notes
in italic, and a real italic beats Chrome's synthesised oblique in a face whose
whole point is character recognition.

They are shipped exactly as published, not subset. The subsetting the brief
allows for is the fallback for families that publish only TTF; these publish
woff2 directly, every file is well under the 150 KB budget, and the ranges we
would have subset to (Latin, Latin-1 Supplement, Latin Extended-A, General
Punctuation, Superscripts and Subscripts, Greek and Coptic, Mathematical
Operators, Arrows, Letterlike Symbols, Miscellaneous Technical) are almost the
whole of what these fonts contain:

| Range | Codepoints in the face |
|---|---|
| U+0000–024F Latin and its supplements | 288 |
| U+2000–206F General Punctuation | 17 |
| U+0370–03FF Greek and Coptic | 4 |
| U+2200–22FF Mathematical Operators | 13 |
| U+2100–214F Letterlike Symbols | 3 |
| U+2070–209F, U+2190–21FF, U+2300–23FF | 0 |

362 codepoints in total, of which 325 are inside those ranges. Subsetting would
drop 37 characters and save well under a kilobyte, so it would cost coverage
and buy nothing.

The practical consequence is worth knowing before a lecture: **these faces
carry only four Greek letters and no arrows or superscripts.** A slide's own
text is drawn by pdf.js from the deck's embedded fonts and is unaffected, but a
term index that writes `σ` or `θ̂` in a lookup card falls through to the next
font in the stack for that character. The stacks in `tokens.css`
(`ui-sans-serif, system-ui` and `ui-monospace, SF Mono, Menlo`) are what render
it, which on a Mac means the system font — legible, just not Atkinson.
