import styles from "./VaultGate.module.css";

export interface VaultGateProps {
  kind: "needs-folder" | "needs-permission" | "unsupported" | "error";
  message?: string;
  onChoose: () => void;
  onReopen: () => void;
}

/**
 * First run, and the one case that follows it: Chrome remembers the folder but
 * not always the permission, so the way back is a single button pressed by
 * hand — `requestPermission` only works from inside a click.
 */
export function VaultGate({
  kind,
  message,
  onChoose,
  onReopen,
}: VaultGateProps): React.JSX.Element {
  if (kind === "unsupported") {
    return (
      <main className={styles["screen"]}>
        <div className={styles["panel"]}>
          <h1 className={styles["title"]}>This browser cannot open a folder</h1>
          <p className={styles["body"]}>
            The app reads and writes your lecture folder directly, which needs the File System
            Access API. Open it in Chrome.
          </p>
        </div>
      </main>
    );
  }

  if (kind === "needs-permission") {
    return (
      <main className={styles["screen"]}>
        <div className={styles["panel"]}>
          <h1 className={styles["title"]}>Your folder needs to be opened again</h1>
          <p className={styles["body"]}>
            Chrome remembers the folder but asks for permission again this visit.
          </p>
          <button type="button" className={styles["action"]} onClick={onReopen}>
            Reopen vault
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles["screen"]}>
      <div className={styles["panel"]}>
        {kind === "error" && message && <p className={styles["error"]}>{message}</p>}
        <button type="button" className={styles["action"]} onClick={onChoose}>
          Choose your lectures folder
        </button>
        <p className={styles["body"]}>
          Everything stays on your disk. The app reads the folder you pick and writes only the
          notes and slide times of the lecture you have open.
        </p>
      </div>
    </main>
  );
}
