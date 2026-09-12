import { useEffect, useRef } from "react";

import styles from "./KeymapOverlay.module.css";

export interface KeymapEntry {
  keys: string;
  action: string;
}

/**
 * Every binding in the app, grouped the way ui-direction.md §D groups them by
 * context: the slide, the note field, the lookup card, review, the library, the
 * command palette, and the handful that work anywhere. Sentence case, and
 * nothing listed that is not actually bound.
 */
export const KEYMAP: Array<{ group: string; entries: KeymapEntry[] }> = [
  {
    group: "Slides",
    entries: [
      { keys: "Right, Space, PageDown", action: "Next slide" },
      { keys: "Left, Shift+Space, PageUp", action: "Previous slide" },
      { keys: "0–9 then Enter", action: "Jump to that slide" },
      { keys: "Backspace", action: "Edit the slide number you are typing" },
      { keys: "Esc", action: "Forget the slide number you are typing" },
      { keys: "- and =", action: "Dim and brighten the slide" },
    ],
  },
  {
    group: "Notes",
    entries: [
      { keys: "n", action: "Type a note" },
      { keys: "Enter", action: "Commit the note" },
      { keys: "Esc", action: "Cancel the note" },
    ],
  },
  {
    group: "Lookup",
    entries: [
      { keys: "e", action: "Explain the selection, or the term under the cursor" },
      { keys: "t and Shift+T", action: "Step through this slide's known terms" },
      { keys: "Enter", action: "Open the card for the term under the cursor" },
      { keys: "Esc", action: "Close the card, then clear the term cursor" },
    ],
  },
  {
    group: "Review",
    entries: [
      { keys: "j and k", action: "Move between the notes on this slide" },
      { keys: "Enter", action: "Show a note's quote, or a question's answer" },
      { keys: "g", action: "Open and close the glossary" },
      { keys: "] and [", action: "Next and previous slide that has notes" },
      { keys: "o", action: "Open this lecture's Markdown in Obsidian" },
      { keys: "Option+E", action: "How to re-export the Markdown" },
    ],
  },
  {
    group: "Library",
    entries: [
      { keys: "j and k", action: "Move between lectures" },
      { keys: "Up and Down", action: "Move between lectures" },
      { keys: "Enter", action: "Open the lecture" },
      { keys: "r", action: "Rescan the folder" },
    ],
  },
  {
    group: "Command palette",
    entries: [
      { keys: "Cmd+K, Ctrl+K", action: "Open the command palette" },
      { keys: "Option+K", action: "Open it too, if the browser claims Cmd+K" },
      { keys: "Up and Down", action: "Move through the commands" },
      { keys: "Enter", action: "Run the highlighted command" },
      { keys: "Esc", action: "Close the palette" },
    ],
  },
  {
    group: "Everywhere",
    entries: [
      { keys: "Option+1, 2, 3", action: "Lecture, review, library" },
      { keys: "Option+T", action: "Switch between the dark and light theme" },
      { keys: "?", action: "This list" },
      { keys: "Esc", action: "Back out one level" },
    ],
  },
];

export interface KeymapOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * A plain list in a `<dialog>`, on `?`. It is never open during a lecture
 * unless asked for, and it has no scrim for the same reason the palette has
 * none. The command palette is the other way to find these: it lists the same
 * actions with the same words, and shows the key beside each one.
 */
export function KeymapOverlay({ open, onClose }: KeymapOverlayProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={styles["dialog"]}
      data-testid="keymap-overlay"
      onCancel={(ev) => {
        // Let the KeyRouter own Esc, so the mode machine and the dialog agree.
        ev.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <h1 className={styles["title"]}>Keys</h1>
      <div className={styles["groups"]}>
        {KEYMAP.map((group) => (
          <section key={group.group}>
            <h2 className={styles["group"]}>{group.group}</h2>
            <dl className={styles["list"]}>
              {group.entries.map((entry) => (
                <div key={entry.keys} className={styles["row"]}>
                  <dt className={styles["keys"]}>{entry.keys}</dt>
                  <dd className={styles["action"]}>{entry.action}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className={styles["footer"]}>Esc closes this.</p>
    </dialog>
  );
}
