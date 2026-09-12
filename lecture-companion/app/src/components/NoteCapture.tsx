import { useEffect, useRef } from "react";

import styles from "./NoteCapture.module.css";

export interface NoteCaptureProps {
  value: string;
  onChange: (value: string) => void;
}

/**
 * The single-line note field: 640 px, above the strip, mounted on `n` and gone
 * the moment it commits or cancels (ui-direction.md §C). Enter and Esc are
 * handled by the KeyRouter, not here, so the mode machine stays the only
 * authority on what a key means.
 */
export function NoteCapture({ value, onChange }: NoteCaptureProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className={styles["wrap"]}>
      <input
        ref={ref}
        className={styles["input"]}
        data-testid="note-input"
        type="text"
        value={value}
        spellCheck={false}
        autoComplete="off"
        aria-label="Note for this slide"
        onChange={(ev) => onChange(ev.target.value)}
      />
    </div>
  );
}
