import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  lookup,
  lookupTerm,
  termsOnPageInLineOrder,
  type LookupResult,
  type LookupSelection,
  type SpanIndex,
  type SpanPage,
  type Term,
  type TermIndex,
  type TermPage,
} from "@lecture/core";

import type { KeyMode } from "../keys/KeyRouter.ts";

import { cursorReadout, stepCursor } from "./TermCursor.ts";

/**
 * Highlight to explain, as one piece of state (architecture.md §7, §9).
 *
 * Three things can be pointing at the slide at once and only one of them may
 * be tinted: an open card (active), the `t` cursor (hover-linked), and the
 * tint a closed card leaves behind until the selection collapses. The
 * precedence here is what keeps the resting slide clean, which is
 * anti-pattern 3.
 *
 * The router mode is driven from here rather than from the key handler,
 * because the mode is what makes Esc pop exactly one level: the card first,
 * then the term cursor.
 */

const MESSAGE_MS = 2000;

export const NO_INDEX_MESSAGE = "no term index for this lecture";
export const NO_SELECTION_MESSAGE = "select a phrase first";
export const NO_TERMS_MESSAGE = "no terms on this slide";

export type HighlightState = "hover" | "active";

export interface Highlight {
  lineIds: number[];
  state: HighlightState;
}

export interface UseLookupOptions {
  page: number;
  spans: SpanIndex | null;
  terms: TermIndex | null;
  /** The live selection, read at the instant the key is pressed. */
  readSelection: () => LookupSelection | null;
  setKeyMode: (mode: KeyMode) => void;
}

export interface Lookup {
  /** The open card, or null. */
  card: LookupResult | null;
  highlight: Highlight | null;
  /** A transient strip line, shown for two seconds. */
  message: string | null;
  /** The `t` cursor readout for the strip, e.g. `term 3/6 majority vote`. */
  cursorText: string | null;
  explain: () => void;
  activate: () => void;
  cycle: (direction: 1 | -1) => void;
  close: () => void;
  showTerm: (termId: string) => void;
  /** Told by the SelectionWatcher; a collapsed selection drops the tint. */
  noteSelection: (selection: LookupSelection | null) => void;
}

/** The lines a result highlights. `noIndex` highlights nothing. */
function linesOf(result: LookupResult): number[] {
  return result.kind === "noIndex" ? [] : result.lineIds;
}

function pageOf<T extends { page: number }>(pages: T[], page: number): T | null {
  return pages.find((p) => p.page === page) ?? null;
}

export function useLookup({
  page,
  spans,
  terms,
  readSelection,
  setKeyMode,
}: UseLookupOptions): Lookup {
  const [card, setCard] = useState<LookupResult | null>(null);
  const [fromSelection, setFromSelection] = useState(false);
  const [lingering, setLingering] = useState<number[] | null>(null);
  const [cursorIndex, setCursorIndex] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const spansPage: SpanPage | null = useMemo(
    () => (spans ? pageOf(spans.pages, page) : null),
    [spans, page],
  );
  const termPage: TermPage | null = useMemo(
    () => (terms ? pageOf(terms.pages, page) : null),
    [terms, page],
  );
  const ordered: Term[] = useMemo(
    () => (termPage && spansPage ? termsOnPageInLineOrder(termPage, spansPage) : []),
    [termPage, spansPage],
  );

  const flash = useCallback((text: string) => {
    setMessage(text);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setMessage(null);
    }, MESSAGE_MS);
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  // A page change closes the card and drops the cursor: the anchors on screen
  // belonged to the page that just left.
  useEffect(() => {
    setCard(null);
    setFromSelection(false);
    setLingering(null);
    setCursorIndex(null);
    setKeyMode("idle");
  }, [page, setKeyMode]);

  const open = useCallback(
    (result: LookupResult, bySelection: boolean) => {
      if (result.kind === "noIndex") {
        flash(NO_INDEX_MESSAGE);
        return;
      }
      setCard(result);
      setFromSelection(bySelection);
      setLingering(null);
      setKeyMode("cardOpen");
    },
    [flash, setKeyMode],
  );

  const openCursor = useCallback(
    (index: number): boolean => {
      const term = ordered[index];
      if (!term || !termPage || !spansPage) return false;
      open(lookupTerm(term, termPage, spansPage), false);
      return true;
    },
    [ordered, termPage, spansPage, open],
  );

  const explain = useCallback(() => {
    if (!terms) {
      flash(NO_INDEX_MESSAGE);
      return;
    }
    const selection = readSelection();
    if (selection && selection.page === page && spansPage) {
      open(lookup(selection, spansPage, terms), true);
      return;
    }
    if (cursorIndex !== null && openCursor(cursorIndex)) return;
    flash(NO_SELECTION_MESSAGE);
  }, [terms, readSelection, page, spansPage, open, cursorIndex, openCursor, flash]);

  /** Enter: the cursor first, since Enter is the cursor's own commit key. */
  const activate = useCallback(() => {
    if (cursorIndex !== null && openCursor(cursorIndex)) return;
    explain();
  }, [cursorIndex, openCursor, explain]);

  const cycle = useCallback(
    (direction: 1 | -1) => {
      if (!terms) {
        flash(NO_INDEX_MESSAGE);
        return;
      }
      if (ordered.length === 0) {
        flash(NO_TERMS_MESSAGE);
        return;
      }
      const next = stepCursor(cursorIndex, direction, ordered.length);
      if (next === null) return;
      setCursorIndex(next);
      setLingering(null);
      setMessage(null);
      // With a card already open the card follows the cursor; with none, the
      // cursor only tints, and `e` or Enter is what opens it.
      if (card) openCursor(next);
      else setKeyMode("cardOpen");
    },
    [terms, ordered, cursorIndex, card, openCursor, flash, setKeyMode],
  );

  const close = useCallback(() => {
    if (card) {
      // The selection's tint outlives its card, until the selection collapses.
      setLingering(fromSelection ? linesOf(card) : null);
      setCard(null);
      setFromSelection(false);
      setKeyMode(cursorIndex === null ? "idle" : "cardOpen");
      return;
    }
    if (cursorIndex !== null) {
      setCursorIndex(null);
      setKeyMode("idle");
      return;
    }
    setLingering(null);
    setKeyMode("idle");
  }, [card, fromSelection, cursorIndex, setKeyMode]);

  const showTerm = useCallback(
    (termId: string) => {
      if (!terms || !termPage || !spansPage) return;
      const onPage = termPage.terms.find((t) => t.id === termId);
      if (onPage) {
        const index = ordered.findIndex((t) => t.id === termId);
        if (index >= 0) setCursorIndex(index);
        open(lookupTerm(onPage, termPage, spansPage), false);
        return;
      }
      const entry = terms.glossary.find((g) => g.id === termId);
      if (!entry) return;
      open(
        lookupTerm(
          {
            id: entry.id,
            term: entry.term,
            aliases: [...entry.aliases],
            kind: entry.kind,
            lineIds: [],
            definition: entry.definition,
            intuition: entry.intuition,
            inThisCourse: entry.inThisCourse,
            confidence: "medium",
          },
          termPage,
          spansPage,
        ),
        false,
      );
    },
    [terms, termPage, spansPage, ordered, open],
  );

  const noteSelection = useCallback((selection: LookupSelection | null) => {
    if (selection === null) setLingering(null);
  }, []);

  const cursorTerm = cursorIndex === null ? null : (ordered[cursorIndex] ?? null);
  const highlight: Highlight | null = card
    ? { lineIds: linesOf(card), state: "active" }
    : cursorTerm
      ? { lineIds: cursorTerm.lineIds, state: "hover" }
      : lingering
        ? { lineIds: lingering, state: "hover" }
        : null;

  return {
    card,
    highlight: highlight && highlight.lineIds.length > 0 ? highlight : null,
    message,
    cursorText:
      cursorTerm && cursorIndex !== null
        ? cursorReadout(cursorIndex, ordered.length, cursorTerm)
        : null,
    explain,
    activate,
    cycle,
    close,
    showTerm,
    noteSelection,
  };
}
