import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./CommandPalette.module.css";

export interface PaletteCommand {
  /** Stable, and what the tests address a row by. */
  id: string;
  /** Sentence case, the same words the keymap overlay uses. */
  title: string;
  /** The keystroke that does the same thing, when there is one. */
  keys?: string;
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

/** `["go", "lib"]` from `"  Go   LIB "`. */
function tokenize(query: string): string[] {
  return query.toLowerCase().split(/\s+/u).filter((t) => t.length > 0);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i += 1;
    if (i === needle.length) return true;
  }
  return needle.length === 0;
}

/**
 * How well one token fits a command, lower being better, or null for no fit.
 *
 * Subsequence matching, per word first: "gl" finds "Go to library" through
 * `library`, "opnrev" finds "Open review" across the whole string. Word
 * prefixes beat word substrings beat in-word subsequences beat a match that
 * had to run across the words, so typing the start of a word gets you the
 * command you meant rather than the longest one that happens to contain the
 * letters.
 */
function tokenScore(token: string, words: string[], whole: string): number | null {
  let best: number | null = null;
  for (const word of words) {
    let s: number | null = null;
    if (word.startsWith(token)) s = 0;
    else if (word.includes(token)) s = 1;
    else if (isSubsequence(token, word)) s = 2;
    if (s !== null && (best === null || s < best)) best = s;
  }
  if (best !== null) return best;
  return isSubsequence(token, whole) ? 3 : null;
}

export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return commands;
  const scored: Array<{ command: PaletteCommand; score: number; index: number }> = [];
  commands.forEach((command, index) => {
    const whole = `${command.title} ${command.keys ?? ""}`.toLowerCase();
    const words = whole.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0);
    let total = 0;
    for (const token of tokens) {
      const s = tokenScore(token, words, whole);
      if (s === null) return;
      total += s;
    }
    scored.push({ command, score: total, index });
  });
  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
  return scored.map((s) => s.command);
}

/**
 * The command palette: Cmd+K, Ctrl+K or Option+K anywhere.
 *
 * A `<dialog>` 520 px wide, anchored 96 px from the top of the window, on
 * `--surface-raised` inside a 1 px `--rule`, with **no scrim** — during a
 * lecture nothing may dim the professor's slide (anti-pattern 1). The router
 * closes any open lookup card before this opens, so the palette never covers
 * the line a card was anchored to.
 *
 * While it is open the FSM is in `palette` mode, which means bare letters are
 * typed into the input instead of firing shortcuts. Esc is the router's; the
 * arrows and Enter are this component's.
 */
export function CommandPalette({ open, commands, onClose }: CommandPaletteProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  /**
   * True while a close this component asked for is still in flight. A
   * `<dialog>` fires `close` on a queued task, not inside `close()`, so the
   * event lands *after* the command has run and would otherwise undo whatever
   * the command just opened.
   */
  const selfClosing = useRef(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const shown = useMemo(() => filterCommands(commands, query), [commands, query]);
  const active = shown[Math.min(cursor, Math.max(shown.length - 1, 0))];

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setCursor(0);
      selfClosing.current = false;
      dialog.showModal();
      inputRef.current?.focus();
    }
    if (!open && dialog.open) {
      selfClosing.current = true;
      dialog.close();
    }
  }, [open]);

  // Keep the highlighted row on screen when the arrows walk past the fold.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[Math.min(cursor, shown.length - 1)];
    el?.scrollIntoView({ block: "nearest" });
  }, [cursor, open, shown.length]);

  const run = (command: PaletteCommand | undefined): void => {
    if (!command) return;
    /*
     * Shut the dialog by hand before the command runs, rather than letting the
     * state change do it on the next commit. Closing a modal `<dialog>` gives
     * focus back to whatever had it before, and it has to do that *first*: a
     * command that opens the note field would otherwise be focused and then
     * immediately unfocused.
     */
    selfClosing.current = true;
    ref.current?.close();
    onClose();
    command.run();
  };

  return (
    <dialog
      ref={ref}
      className={styles["dialog"]}
      data-testid="command-palette"
      onCancel={(ev) => {
        // The KeyRouter owns Esc, so the mode machine and the dialog agree.
        ev.preventDefault();
        onClose();
      }}
      onClose={() => {
        // Only a close we did not ask for needs reporting; ours was announced
        // when it was made.
        if (selfClosing.current) {
          selfClosing.current = false;
          return;
        }
        onClose();
      }}
    >
      <input
        ref={inputRef}
        className={styles["input"]}
        data-testid="palette-input"
        type="text"
        value={query}
        placeholder="Type a command"
        aria-label="Type a command"
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={active ? `palette-${active.id}` : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setCursor(0);
        }}
        onKeyDown={(ev) => {
          /*
           * The three keys the FSM deliberately leaves to the focused input
           * (ui-direction.md §D). They are stopped here as well as handled,
           * because the app's one `keydown` listener is on `window`: without
           * that, the Enter that runs "Type a note" would go on to reach the
           * router, which by then is in `noteInput`, and commit the empty note
           * it had just opened. Esc is not stopped — that one is the router's.
           */
          if (ev.key === "ArrowDown") {
            ev.preventDefault();
            ev.stopPropagation();
            setCursor((c) => Math.min(shown.length - 1, c + 1));
          } else if (ev.key === "ArrowUp") {
            ev.preventDefault();
            ev.stopPropagation();
            setCursor((c) => Math.max(0, c - 1));
          } else if (ev.key === "Enter") {
            ev.preventDefault();
            ev.stopPropagation();
            run(active);
          }
        }}
      />
      <ul ref={listRef} className={styles["list"]} id="palette-list" role="listbox">
        {shown.map((command, index) => (
          <li
            key={command.id}
            id={`palette-${command.id}`}
            className={styles["row"]}
            data-testid="palette-row"
            data-command={command.id}
            role="option"
            aria-selected={command === active}
            data-active={command === active ? "true" : undefined}
            onPointerDown={(ev) => {
              // Pointer down, not click: a click would move focus out of the
              // input first and close the dialog before the command ran.
              ev.preventDefault();
              run(command);
            }}
            onPointerEnter={() => setCursor(index)}
          >
            <span className={styles["title"]}>{command.title}</span>
            {command.keys !== undefined && <span className={styles["keys"]}>{command.keys}</span>}
          </li>
        ))}
      </ul>
      {shown.length === 0 && (
        <p className={styles["empty"]} data-testid="palette-empty">
          No command matches that.
        </p>
      )}
    </dialog>
  );
}
