import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useKeyActions } from "../../keys/useKeys.ts";
import { flatten, scanLibrary, type CourseGroup, type LectureEntry } from "../../lib/library.ts";
import { navigate, ROOT_COURSE } from "../../state/routes.ts";
import type { LectureFolder } from "../../storage/LectureFolder.ts";

import { StatusPips } from "./StatusPips.tsx";
import styles from "./Library.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-03-04` as `Mar 04`, parsed as text so no timezone can shift the day. */
function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  const index = Number.parseInt(month ?? "", 10) - 1;
  const name = MONTHS[index];
  return name && day ? `${name} ${day}` : date;
}

function openLecture(entry: LectureEntry): void {
  navigate({
    kind: entry.hasNotes ? "review" : "lecture",
    course: entry.course,
    lectureId: entry.lectureId,
  });
}

export interface LibraryProps {
  root: LectureFolder;
}

/**
 * The vault as a single left-aligned column: courses, then lectures newest
 * first. `j`/`k` move a roving focus, Enter opens, `r` rescans. Rows are
 * `tabindex=0`, so everything j/k reaches is reachable by Tab too
 * (anti-pattern 10).
 */
export function Library({ root }: LibraryProps): React.JSX.Element {
  const [groups, setGroups] = useState<CourseGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const rows = useMemo(() => (groups ? flatten(groups) : []), [groups]);

  const rescan = useCallback(() => {
    setError(null);
    scanLibrary(root).then(
      (found) => {
        setGroups(found);
        setCursor((c) => Math.min(c, Math.max(0, flatten(found).length - 1)));
      },
      (err: unknown) => {
        setGroups([]);
        setError(
          `The folder could not be read: ${err instanceof Error ? err.message : String(err)}. ` +
            "Check that it is still on disk, then press r.",
        );
      },
    );
  }, [root]);

  useEffect(rescan, [rescan]);

  const focusRow = useCallback((index: number) => {
    rowsRef.current[index]?.focus();
  }, []);

  useKeyActions((action) => {
    switch (action.type) {
      case "focusNext":
        setCursor((c) => {
          const next = Math.min(rows.length - 1, c + 1);
          queueMicrotask(() => focusRow(next));
          return next;
        });
        break;
      case "focusPrev":
        setCursor((c) => {
          const next = Math.max(0, c - 1);
          queueMicrotask(() => focusRow(next));
          return next;
        });
        break;
      case "activate": {
        const entry = rows[cursor];
        if (entry) openLecture(entry);
        break;
      }
      case "rescan":
        rescan();
        break;
      default:
        break;
    }
  });

  if (groups === null) {
    return (
      <main className={styles["screen"]}>
        <p className={styles["note"]}>Reading the folder.</p>
      </main>
    );
  }

  let rowIndex = -1;

  return (
    <main className={styles["screen"]}>
      <div className={styles["column"]}>
        {error && <p className={styles["error"]}>{error}</p>}
        {!error && rows.length === 0 && (
          <p className={styles["note"]}>
            No lectures here yet. A lecture is a folder with a lecture.json in it, either
            directly in this folder or one level down under its course. Run lecture prepare
            on a deck, then press r.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.course} className={styles["course"]}>
            <header className={styles["courseHead"]}>
              <h2 className={styles["courseTitle"]}>
                {group.courseTitle}
                {group.course !== ROOT_COURSE && group.courseTitle !== group.course && (
                  <span className={styles["courseCode"]}> {group.course}</span>
                )}
              </h2>
              <span className={styles["count"]}>
                {group.lectures.length} {group.lectures.length === 1 ? "lecture" : "lectures"}
              </span>
            </header>
            <ul className={styles["rows"]}>
              {group.lectures.map((entry) => {
                rowIndex += 1;
                const index = rowIndex;
                const key = `${entry.course}/${entry.lectureId}`;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      className={styles["row"]}
                      data-testid="lecture-row"
                      data-lecture={entry.lectureId}
                      data-course={entry.course}
                      aria-current={index === cursor ? "true" : undefined}
                      ref={(el) => {
                        rowsRef.current[index] = el;
                      }}
                      onFocus={() => setCursor(index)}
                      onClick={() => openLecture(entry)}
                    >
                      <span className={styles["number"]}>
                        {entry.manifest.number === undefined
                          ? ""
                          : String(entry.manifest.number).padStart(2, "0")}
                      </span>
                      <span className={styles["title"]}>
                        {entry.manifest.title ?? entry.lectureId}
                      </span>
                      <span className={styles["date"]}>{shortDate(entry.manifest.date)}</span>
                      <StatusPips pips={entry.pips} />
                      <span className={styles["slides"]} data-testid="page-count">
                        {entry.manifest.deck.pages} slides
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
        <p className={styles["hint"]}>j and k move, Enter opens, r rescans, ? lists every key.</p>
      </div>
    </main>
  );
}
