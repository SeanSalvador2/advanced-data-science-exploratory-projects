import styles from "./StatusStrip.module.css";

export type StripTone = "ink" | "muted" | "stale";

export interface StripItem {
  key: string;
  text: string;
  tone?: StripTone;
}

export interface StatusStripProps {
  items: StripItem[];
  /** The mode word, right-aligned. Lower case, one word (ui-direction.md §C). */
  mode: string;
}

const toneClass: Record<StripTone, string> = {
  ink: styles["ink"] as string,
  muted: styles["muted"] as string,
  stale: styles["stale"] as string,
};

/**
 * The 28 px strip: the only chrome on the resting lecture screen. Mono 12 px,
 * items separated by 24 px of space — no middot chain, no pills, no dots
 * (ui-direction.md §C, anti-patterns 4 and 5).
 */
export function StatusStrip({ items, mode }: StatusStripProps): React.JSX.Element {
  return (
    <div className={styles["strip"]} data-testid="status-strip" role="status" aria-live="polite">
      {items.map((item) => (
        <span
          key={item.key}
          className={toneClass[item.tone ?? "muted"]}
          data-strip-item={item.key}
        >
          {item.text}
        </span>
      ))}
      <span className={styles["mode"]} data-strip-item="mode">
        {mode}
      </span>
    </div>
  );
}
