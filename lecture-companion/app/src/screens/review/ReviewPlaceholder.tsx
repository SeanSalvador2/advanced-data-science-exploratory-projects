import { StatusStrip } from "../../components/StatusStrip.tsx";
import { navigate } from "../../state/routes.ts";

import styles from "./ReviewPlaceholder.module.css";

export interface ReviewPlaceholderProps {
  course: string;
  lectureId: string;
}

/** Review mode is task 7. Until then this says so and offers the way back. */
export function ReviewPlaceholder({
  course,
  lectureId,
}: ReviewPlaceholderProps): React.JSX.Element {
  return (
    <div className={styles["screen"]}>
      <div className={styles["message"]}>
        <h1 className={styles["title"]}>{lectureId}</h1>
        <p>
          Review mode arrives in task 7. Press Option+1 to open this lecture in lecture mode,
          or Option+3 for the library.
        </p>
        <div className={styles["actions"]}>
          <button
            type="button"
            onClick={() => navigate({ kind: "lecture", course, lectureId })}
          >
            Open in lecture mode
          </button>
          <button type="button" onClick={() => navigate({ kind: "library" })}>
            Back to the library
          </button>
        </div>
      </div>
      <StatusStrip items={[{ key: "state", text: "not built yet" }]} mode="review" />
    </div>
  );
}
