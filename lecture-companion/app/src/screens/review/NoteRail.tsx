import type { Note, OpenQuestion } from "@lecture/core";

import { mmss } from "../../events/time.ts";

import styles from "./NoteRail.module.css";

/**
 * The note rail (ui-direction.md §C, architecture.md §9).
 *
 * One line per note in `notes.json` order — the order the lecture happened in,
 * student and generated interleaved. Provenance is the visual class: a 2 px
 * `--mine` rule in a 12 px gutter and italics for what the student typed,
 * nothing for what the model wrote, and both share a text edge. Confidence is
 * a word in the meta line, never a coloured pill (anti-pattern 4).
 */

/** `why-it-matters` as `Why it matters`. Sentence case, no hyphens, no caps. */
export function tagWords(tag: string): string {
  const words = tag.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function timeText(t: number | null): string | null {
  return t === null ? null : mmss(t);
}

export interface NoteRailProps {
  notes: Note[];
  /** Shown after the notes, on the last page that has any. */
  openQuestions: OpenQuestion[];
  focusId: string | null;
  /** Notes that cite the slide line under the pointer. */
  linkedIds: ReadonlySet<string>;
  /** Whether a note's quote or answer is showing. */
  isOpen: (note: Note) => boolean;
  onFocusNote: (id: string | null) => void;
  onHoverNote: (id: string | null) => void;
  onToggleNote: (id: string) => void;
  /** Lets the screen move the roving focus with j and k. */
  registerNote: (id: string, el: HTMLDivElement | null) => void;
  children?: React.ReactNode;
}

export function NoteRail({
  notes,
  openQuestions,
  focusId,
  linkedIds,
  isOpen,
  onFocusNote,
  onHoverNote,
  onToggleNote,
  registerNote,
  children,
}: NoteRailProps): React.JSX.Element {
  return (
    <aside className={styles["rail"]} data-testid="note-rail">
      <div className={styles["scroll"]}>
        <div className={styles["measure"]} data-testid="rail-measure">
          <p className={styles["label"]}>notes</p>

          {notes.length === 0 ? (
            <p className={styles["empty"]} data-testid="rail-empty">
              No notes on this slide
            </p>
          ) : (
            <div className={styles["list"]} role="list">
              {notes.map((note) => {
                const open = isOpen(note);
                const time = timeText(note.tStart);
                return (
                  <div
                    key={note.id}
                    role="listitem"
                    tabIndex={0}
                    ref={(el) => registerNote(note.id, el)}
                    className={styles["note"]}
                    data-testid="note-line"
                    data-note={note.id}
                    data-kind={note.kind}
                    data-focused={focusId === note.id ? "yes" : "no"}
                    data-linked={linkedIds.has(note.id) ? "yes" : "no"}
                    data-open={open ? "yes" : "no"}
                    onFocus={() => onFocusNote(note.id)}
                    onBlur={() => onFocusNote(null)}
                    onMouseEnter={() => onHoverNote(note.id)}
                    onMouseLeave={() => onHoverNote(null)}
                    onClick={() => onToggleNote(note.id)}
                    onKeyDown={(ev) => {
                      // The window-level KeyRouter owns Enter; the row must not
                      // also act on it, and nothing else here is a shortcut.
                      if (ev.key === " ") ev.preventDefault();
                    }}
                  >
                    <span className={styles["gutter"]} aria-hidden="true" />
                    <div className={styles["body"]}>
                      <p className={styles["text"]}>{note.text}</p>
                      <p className={styles["meta"]}>
                        {time !== null && <span data-testid="note-time">{time}</span>}
                        {note.kind === "generated" && <span>{tagWords(note.tag)}</span>}
                        {note.confidence !== "high" && (
                          <span data-testid="note-confidence">confidence {note.confidence}</span>
                        )}
                      </p>
                      {note.kind === "student" && note.answer !== undefined && open && (
                        <div className={styles["answer"]} data-testid="note-answer">
                          <p className={styles["answerLabel"]}>answered</p>
                          <p className={styles["answerText"]}>{note.answer}</p>
                        </div>
                      )}
                      {note.kind === "generated" && note.quote !== undefined && open && (
                        <p className={styles["quote"]} data-testid="note-quote">
                          {note.quote}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {openQuestions.length > 0 && (
            <section className={styles["questions"]} data-testid="open-questions">
              <h2 className={styles["sectionTitle"]}>Open questions</h2>
              <div className={styles["list"]} role="list">
                {openQuestions.map((question) => (
                  <div key={`${question.page}-${question.text}`} role="listitem" className={styles["note"]}>
                    <span className={styles["gutter"]} aria-hidden="true" />
                    <div className={styles["body"]}>
                      <p className={styles["text"]}>{question.text}</p>
                      <p className={styles["meta"]}>
                        <span>slide {question.page}</span>
                        {question.tStart !== null && <span>{mmss(question.tStart)}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      {children}
    </aside>
  );
}
