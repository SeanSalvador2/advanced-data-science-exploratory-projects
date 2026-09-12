import type { SpanPage } from "@lecture/core";

import styles from "./AnchorLayer.module.css";

/**
 * The highlight layer (ui-direction.md §E): one box per *visual line* of a
 * reference, not one per span, so a highlight has no seams. It is an absolutely
 * positioned sibling of the canvas sharing its box, it never takes a pointer
 * event, and it draws nothing at rest — task 7 adds the resting underline for
 * lines that carry notes.
 *
 * Geometry: `spans.json` boxes are PDF user units at scale 1, so the factor is
 * the rendered width over the page width (architecture.md §4.2).
 */

export type AnchorState = "hover" | "active";

export interface AnchorLayerProps {
  spans: SpanPage | null;
  lineIds: number[];
  state: AnchorState;
  /** The id of the reference every box belongs to, per §E's `data-ref`. */
  refId?: string;
  /** The rendered width of the page in CSS pixels. */
  width: number;
}

export function AnchorLayer({
  spans,
  lineIds,
  state,
  refId,
  width,
}: AnchorLayerProps): React.JSX.Element | null {
  if (!spans || width <= 0 || spans.width <= 0 || lineIds.length === 0) return null;
  const k = width / spans.width;

  const boxes = lineIds
    .map((id) => spans.lines.find((line) => line.id === id))
    .filter((line): line is NonNullable<typeof line> => line !== undefined);
  if (boxes.length === 0) return null;

  return (
    <div className={styles["layer"]} data-testid="anchor-layer" data-state={state}>
      {boxes.map((line, i) => (
        <div
          key={line.id}
          className={styles["anchor"]}
          data-testid="anchor-box"
          data-state={state}
          data-ref={refId ?? ""}
          data-first={i === 0 ? "yes" : "no"}
          data-last={i === boxes.length - 1 ? "yes" : "no"}
          style={{
            // The 1px/2px padding grows the box, so the mark is offset by it
            // and stays centred on the glyphs.
            left: `${line.box[0] * k - 2}px`,
            top: `${line.box[1] * k - 1}px`,
            width: `${line.box[2] * k}px`,
            height: `${line.box[3] * k}px`,
          }}
        />
      ))}
    </div>
  );
}
