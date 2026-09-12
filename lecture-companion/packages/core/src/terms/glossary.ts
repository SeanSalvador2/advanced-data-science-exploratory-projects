import type { GlossaryEntry, Term, TermPage } from "../schemas/terms.js";

/**
 * Collapse every page's terms into the deck-wide glossary (architecture.md
 * §4.3): one entry per term id, the first page that mentions it wins every
 * text field, aliases are unioned in the order they were first seen, and
 * `pages` lists every page the id appears on.
 *
 * Pages are read in page-number order, not array order, so the glossary does
 * not depend on the order the batches happened to be merged in.
 */
export function buildGlossary(pages: TermPage[]): GlossaryEntry[] {
  const entries = new Map<string, GlossaryEntry>();
  const seenAliases = new Map<string, Set<string>>();
  const onPages = new Map<string, Set<number>>();

  for (const page of [...pages].sort((a, b) => a.page - b.page)) {
    for (const term of page.terms) {
      const existing = entries.get(term.id);
      if (existing === undefined) {
        entries.set(term.id, newEntry(term));
        seenAliases.set(term.id, new Set(term.aliases));
        onPages.set(term.id, new Set([page.page]));
        continue;
      }
      const aliases = seenAliases.get(term.id) as Set<string>;
      for (const alias of term.aliases) {
        if (aliases.has(alias)) continue;
        aliases.add(alias);
        existing.aliases.push(alias);
      }
      (onPages.get(term.id) as Set<number>).add(page.page);
    }
  }

  return [...entries.values()].map((entry) => ({
    ...entry,
    pages: [...(onPages.get(entry.id) as Set<number>)].sort((a, b) => a - b),
  }));
}

/** One glossary entry from the first `Term` carrying its id, keys in contract order. */
function newEntry(term: Term): GlossaryEntry {
  return {
    id: term.id,
    term: term.term,
    aliases: dedupe(term.aliases),
    kind: term.kind,
    definition: term.definition,
    intuition: term.intuition,
    inThisCourse: term.inThisCourse,
    ...(term.firstSeen === undefined ? {} : { firstSeen: { ...term.firstSeen } }),
    pages: [],
  };
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
