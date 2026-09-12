import type { Term } from "@lecture/core";

import styles from "./GlossaryPanel.module.css";

/**
 * The glossary, collapsed at the foot of the rail (ui-direction.md §C).
 *
 * It is the page's terms, not the deck's: what is on this slide, with the
 * definition the term index already carries. Hovering an entry tints the lines
 * it appears on; Enter opens the same lookup card `e` would.
 */

export interface GlossaryPanelProps {
  open: boolean;
  terms: Term[];
  focusId: string | null;
  onToggle: () => void;
  onHover: (termId: string | null) => void;
  onFocus: (termId: string | null) => void;
  onOpenTerm: (termId: string) => void;
}

export function GlossaryPanel({
  open,
  terms,
  focusId,
  onToggle,
  onHover,
  onFocus,
  onOpenTerm,
}: GlossaryPanelProps): React.JSX.Element {
  return (
    <section className={styles["panel"]} data-testid="glossary" data-open={open ? "yes" : "no"}>
      <button
        type="button"
        className={styles["head"]}
        data-testid="glossary-toggle"
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(ev) => {
          // The button owns Enter and Space while it has focus; the
          // window-level KeyRouter must not toggle the panel a second time.
          if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
        }}
      >
        <span className={styles["title"]}>glossary</span>
        <span className={styles["hint"]}>g</span>
      </button>

      {open && (
        <div className={styles["entries"]} data-testid="glossary-entries">
          {terms.length === 0 ? (
            <p className={styles["empty"]}>No terms on this slide</p>
          ) : (
            terms.map((term) => (
              <div
                key={term.id}
                role="button"
                tabIndex={0}
                className={styles["entry"]}
                data-testid="glossary-entry"
                data-term={term.id}
                data-focused={focusId === term.id ? "yes" : "no"}
                onMouseEnter={() => onHover(term.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onFocus(term.id)}
                onBlur={() => onFocus(null)}
                onClick={() => onOpenTerm(term.id)}
              >
                <p className={styles["term"]}>{term.term}</p>
                <p className={styles["definition"]}>{term.definition}</p>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
