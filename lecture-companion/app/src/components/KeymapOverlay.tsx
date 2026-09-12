import { useEffect, useRef } from "react";

import styles from "./KeymapOverlay.module.css";

export interface KeymapEntry {
  keys: string;
  action: string;
}

/** Everything bound today. Task 7 adds review, task 8 the palette. */
export const KEYMAP: Array<{ group: string; entries: KeymapEntry[] }> = [
  {
    group: "Slides",
    entries: [
      { keys: "Right, Space, PageDown", action: "Next slide" },
      { keys: "Left, Shift+Space, PageUp", action: "Previous slide" },
      { keys: "0–9 then Enter", action: "Jump to that slide" },
      { keys: "Backspace", action: "Edit the slide number you are typing" },
      { keys: "- and =", action: "Dim and brighten the slide" },
    ],
  },
  {
    group: "Notes",
    entries: [
      { keys: "n", action: "Type a note" },
      { keys: "Enter", action: "Commit the note" },
      { keys: "Esc", action: "Back out one level" },
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
    group: "Library",
    entries: [
      { keys: "j and k", action: "Move between lectures" },
      { keys: "Enter", action: "Open the lecture" },
      { keys: "r", action: "Rescan the folder" },
    ],
  },
  {
    group: "Everywhere",
    entries: [
      { keys: "Option+1, 2, 3", action: "Lecture, review, library" },
      { keys: "Option+T", action: "Switch between the dark and light theme" },
      { keys: "?", action: "This list" },
    ],
  },
  {
    group: "Not built yet",
    entries: [{ keys: "Cmd+K", action: "Command palette (task 8)" }],
  },
];

export interface KeymapOverlayProps {
  open: boolean;
  onClose: () => void;
}

/**
 * A plain list in a `<dialog>`. It is never open during a lecture unless asked
 * for, and it is the only place the theme toggle is documented for now.
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
