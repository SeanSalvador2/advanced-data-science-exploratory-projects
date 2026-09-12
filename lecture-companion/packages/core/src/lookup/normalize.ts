/**
 * Text normalisation for term matching (architecture.md §7 step 2).
 *
 * Matching is case-insensitive, whitespace-collapsed, and lets a hyphen and a
 * space interchange, because the slide writes "trade-off" and the glossary
 * writes "trade off". Punctuation is stripped at the edges only: a bullet, a
 * numbering prefix or a full stop is furniture, but the punctuation *inside*
 * a notation ("‖x′−x‖∞") is the notation.
 *
 * The minus sign U+2212 is deliberately not in the dash class. It is a maths
 * operator inside notation, not a hyphen between words.
 */

const DASH = /[-‐‑‒–—―]/gu;
const WHITESPACE = /\s+/gu;
const LEADING_PUNCT = /^[\p{P}\s]+/u;
const TRAILING_PUNCT = /[\p{P}\s]+$/u;

/** Lower case, collapsed whitespace, hyphen as space, no punctuation at the edges. */
export function normalizeForMatch(s: string): string {
  const flattened = s.normalize("NFC").toLowerCase().replace(DASH, " ").replace(WHITESPACE, " ");
  return flattened.replace(LEADING_PUNCT, "").replace(TRAILING_PUNCT, "");
}

/**
 * The normalised string as words, each word stripped of its own edge
 * punctuation, so "bigger margin, bigger certificate" yields the word
 * "margin" rather than "margin,".
 */
export function matchWords(s: string): string[] {
  const out: string[] = [];
  for (const raw of normalizeForMatch(s).split(" ")) {
    const word = raw.replace(LEADING_PUNCT, "").replace(TRAILING_PUNCT, "");
    if (word !== "") out.push(word);
  }
  return out;
}

/** Whether `needle` occurs in `hay` as a run of whole words. */
export function containsWords(hay: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let all = true;
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** One of `names` equals `normalized` after normalisation. */
export function matchesExactly(names: readonly string[], normalized: string): boolean {
  if (normalized === "") return false;
  return names.some((name) => normalizeForMatch(name) === normalized);
}

/** One of `names` occurs inside `words` as a run of whole words. */
export function namedIn(names: readonly string[], words: string[]): boolean {
  return names.some((name) => containsWords(words, matchWords(name)));
}
