import { useLayoutEffect, useRef, useState } from "react";

import type { LookupResult } from "@lecture/core";

import {
  CARD_GAP,
  CARD_WIDTH,
  placeCard,
  type Placement,
  type Rect,
} from "./position.ts";
import styles from "./LookupCard.module.css";

/**
 * The anchored explanation card (ui-direction.md §C).
 *
 * Anchored, not centred, and with no scrim: the slide stays lit and visible,
 * which is anti-pattern 1. It does not trap focus — the chips are reachable
 * with Tab and everything else on the screen stays reachable too — and Esc is
 * routed by the KeyRouter like every other key.
 */

export interface LookupCardProps {
  result: LookupResult;
  /** The first highlighted line box, in viewport pixels. */
  anchor: Rect;
  /** The slide box the card is clamped inside, in viewport pixels. */
  slide: Rect;
  onPickTerm: (termId: string) => void;
}

interface Chip {
  id: string;
  label: string;
}

function chipsOf(result: LookupResult): Chip[] {
  if (result.kind === "passage") return result.terms.map((t) => ({ id: t.id, label: t.term }));
  if (result.kind === "summary") return result.nearby.map((g) => ({ id: g.id, label: g.term }));
  return [];
}

export function LookupCard({
  result,
  anchor,
  slide,
  onPickTerm,
}: LookupCardProps): React.JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const key =
    result.kind === "term"
      ? result.term.id
      : result.kind === "passage"
        ? result.passage.lineIds.join(",")
        : result.kind;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPlacement(placeCard(anchor, slide, { width: CARD_WIDTH, height: el.offsetHeight }));
  }, [key, anchor.left, anchor.top, anchor.width, anchor.height, slide.left, slide.top, slide.width, slide.height]);

  if (result.kind === "noIndex") return null;

  const chips = chipsOf(result);
  const placed = placement !== null;
  const leaderTop = placement?.flipped
    ? anchor.top - CARD_GAP
    : anchor.top + anchor.height;

  return (
    <>
      {placed && (
        <div
          className={styles["leader"]}
          data-testid="lookup-leader"
          data-flipped={placement.flipped ? "yes" : "no"}
          style={{
            left: `${Math.max(anchor.left + 1, Math.min(anchor.left + anchor.width / 2, anchor.left + anchor.width - 1))}px`,
            top: `${leaderTop}px`,
            height: `${CARD_GAP}px`,
          }}
        />
      )}
      <div
        ref={ref}
        className={styles["card"]}
        data-testid="lookup-card"
        data-kind={result.kind}
        data-placed={placed ? "yes" : "no"}
        data-flipped={placement?.flipped ? "yes" : "no"}
        role="dialog"
        aria-live="polite"
        aria-label="Explanation"
        style={{
          width: `${CARD_WIDTH}px`,
          left: `${placement?.left ?? 0}px`,
          top: `${placement?.top ?? 0}px`,
        }}
      >
        {result.kind === "term" && (
          <>
            <p className={styles["phrase"]} data-testid="lookup-phrase">
              {result.term.term}
            </p>
            <p className={styles["body"]}>{result.term.definition}</p>
            {result.term.intuition !== "" && (
              <p className={styles["muted"]}>{result.term.intuition}</p>
            )}
            {result.term.inThisCourse !== "" && (
              <p className={styles["muted"]}>{result.term.inThisCourse}</p>
            )}
          </>
        )}

        {result.kind === "passage" && (
          <>
            <p className={styles["phrase"]} data-testid="lookup-phrase">
              {result.passage.text}
            </p>
            <p className={styles["body"]} data-testid="lookup-explanation">
              {result.passage.explanation}
            </p>
          </>
        )}

        {result.kind === "summary" && (
          <>
            <p className={styles["phrase"]} data-testid="lookup-phrase">
              Not in the index
            </p>
            <p className={styles["body"]}>{result.page.summary}</p>
          </>
        )}

        {chips.length > 0 && (
          <div className={styles["chips"]}>
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={styles["chip"]}
                data-testid="lookup-chip"
                data-term={chip.id}
                onClick={() => onPickTerm(chip.id)}
                onKeyDown={(ev) => {
                  // The chip owns Enter and Space while it has focus; the
                  // window-level KeyRouter must not also act on them.
                  if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
                }}
              >
                {chip.label}
              </button>
            ))}
          </div>
        )}

        <p className={styles["meta"]} data-testid="lookup-meta">
          <span>slide {result.page.page}</span>
          <span>{result.kind}</span>
          <span>esc close</span>
        </p>
      </div>
    </>
  );
}
