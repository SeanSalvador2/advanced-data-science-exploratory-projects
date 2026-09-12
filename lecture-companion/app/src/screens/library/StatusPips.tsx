import { PIP_STEPS, type PipStep } from "../../lib/library.ts";

import styles from "./StatusPips.module.css";

export interface StatusPipsProps {
  pips: Record<PipStep, boolean>;
}

/**
 * Five pips: prepared, terms, recorded, transcribed, notes (architecture.md
 * §9). Filled means done, hollow means not yet. No colour, no badge, no pill
 * — a pip is a shape, and the only thing it encodes is done or not
 * (ui-direction.md §C, anti-pattern 4).
 */
export function StatusPips({ pips }: StatusPipsProps): React.JSX.Element {
  const label = PIP_STEPS.filter((step) => pips[step]).join(", ") || "nothing done yet";
  return (
    <span
      className={styles["pips"]}
      aria-label={label}
      title={label}
      data-pips={PIP_STEPS.map((step) => (pips[step] ? "1" : "0")).join("")}
    >
      {PIP_STEPS.map((step) => (
        <span
          key={step}
          className={pips[step] ? styles["filled"] : styles["hollow"]}
          data-pip={step}
          data-done={pips[step] ? "yes" : "no"}
        />
      ))}
    </span>
  );
}
