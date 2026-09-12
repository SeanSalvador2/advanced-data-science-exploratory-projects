import type { SpanPage } from "@lecture/core";

import { anchorSpecs, type AnchorRef, type AnchorState } from "../notes/pageIndex.ts";

import styles from "./AnchorLayer.module.css";

/**
 * The highlight layer (ui-direction.md §E): one box per *visual line* of a
 * reference, not one per span, so a highlight has no seams. It is an absolutely
 * positioned sibling of the canvas sharing its box and it never takes a pointer
 * event — hover on the slide is one `pointermove` on the stage, tested against
 * the line boxes.
 *
 * Two callers. Lecture mode lights one reference at a time and passes
 * `lineIds` plus a state. Review mode passes every reference the page carries
 * at once through `refs`: the lines a note points at rest under a 1 px
 * underline, the note being hovered tints, and the focused note goes active.
 *
 * Geometry: `spans.json` boxes are PDF user units at scale 1, so the factor is
 * the rendered width over the page width (architecture.md §4.2).
 */

export type { AnchorRef, AnchorState };

export interface AnchorLayerProps {
  spans: SpanPage | null;
  /** Lecture mode's single reference. */
  lineIds?: number[];
  state?: AnchorState;
  /** The id of the reference every box belongs to, per §E's `data-ref`. */
  refId?: string;
  /** Review mode: every reference on the page, each with its own state. */
  refs?: readonly AnchorRef[];
  /** The rendered width of the page in CSS pixels. */
  width: number;
}

export function AnchorLayer({
  spans,
  lineIds,
  state,
  refId,
  refs,
  width,
}: AnchorLayerProps): React.JSX.Element | null {
  if (!spans || width <= 0 || spans.width <= 0) return null;

  const all: AnchorRef[] =
    refs !== undefined
      ? refs.filter((ref) => ref.lineIds.length > 0)
      : lineIds && lineIds.length > 0
        ? [{ id: refId ?? "", lineIds, state: state ?? "hover" }]
        : [];
  if (all.length === 0) return null;

  const k = width / spans.width;
  const boxes = [];
  for (const spec of anchorSpecs(all)) {
    const line = spans.lines.find((l) => l.id === spec.lineId);
    if (line) boxes.push({ spec, line });
  }
  if (boxes.length === 0) return null;

  return (
    <div className={styles["layer"]} data-testid="anchor-layer">
      {boxes.map(({ spec, line }) => (
        <div
          key={line.id}
          className={styles["anchor"]}
          data-testid="anchor-box"
          data-state={spec.state}
          data-ref={spec.refId}
          data-line={line.id}
          data-mine={spec.mine ? "yes" : "no"}
          data-first={spec.first ? "yes" : "no"}
          data-last={spec.last ? "yes" : "no"}
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
