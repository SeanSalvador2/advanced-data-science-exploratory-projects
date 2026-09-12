import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { LookupSelection, Note, SpanPage, Term, TermPage } from "@lecture/core";

import { AnchorLayer, type AnchorRef, type AnchorState } from "../../anchors/AnchorLayer.tsx";
import { useKeyActions, useSetKeyMode } from "../../keys/useKeys.ts";
import { LookupCard } from "../../lookup/LookupCard.tsx";
import { firstLineRect, type Rect } from "../../lookup/position.ts";
import { useLookup } from "../../lookup/useLookup.ts";
import {
  isDarkDeck,
  lastPageWithNotes,
  lineAtPoint,
  loadReview,
  nextPageWithNotes,
  notesOnPage,
  pagesWithNotes,
  prevPageWithNotes,
  referencedLines,
  rememberDeck,
  rememberedDeck,
  sampleCanvasLuminance,
  type ReviewData,
} from "../../notes/index.ts";
import type { TextLayerHost } from "../../pdf/TextLayerHost.ts";
import { SelectionWatcher } from "../../selection/SelectionWatcher.ts";
import { loadLastPage, saveLastPage } from "../../state/persist.ts";
import { folderPath, navigate } from "../../state/routes.ts";
import type { LectureFolder } from "../../storage/LectureFolder.ts";

import { SlideStage, type SlideGeometry } from "../lecture/SlideStage.tsx";
import { GlossaryPanel } from "./GlossaryPanel.tsx";
import { loadGlossaryOpen, saveGlossaryOpen } from "./glossaryPrefs.ts";
import { NoteRail } from "./NoteRail.tsx";
import styles from "./Review.module.css";

/** How long `o` and Option+E leave their line in the header. */
const MESSAGE_MS = 3000;

export const OBSIDIAN_UNAVAILABLE = "the browser cannot see the vault path";
export const EXPORT_MESSAGE = "run lecture export-md in a terminal";

export interface ReviewProps {
  root: LectureFolder;
  course: string;
  lectureId: string;
}

/**
 * Review mode (architecture.md §9): the slide on the left, the note rail on
 * the right, the glossary collapsed beneath it.
 *
 * Reciprocity is one `hovered`/`focused` pair. Hovering or focusing a note
 * tints the slide lines it cites; hovering one of those lines tints the notes
 * that cite it. Nothing else on the slide is marked, because a permanently
 * tinted highlight on a resting slide is anti-pattern 3 — a line that carries
 * a note rests under a 1 px underline and nothing more.
 *
 * The app never writes Markdown. `o` hands the exported file to Obsidian and
 * Option+E says which command re-renders it; neither writes anything.
 */
export function Review({ root, course, lectureId }: ReviewProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<ReviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [digits, setDigits] = useState("");
  const [transient, setTransient] = useState<string | null>(null);

  const [focusNoteId, setFocusNoteId] = useState<string | null>(null);
  const [hoverNoteId, setHoverNoteId] = useState<string | null>(null);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [focusTermId, setFocusTermId] = useState<string | null>(null);
  const [hoverTermId, setHoverTermId] = useState<string | null>(null);
  const [extras, setExtras] = useState<Record<string, boolean>>({});
  const [glossaryOpen, setGlossaryOpen] = useState(loadGlossaryOpen);

  const path = folderPath(course, lectureId);

  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);
    void loadReview(root, path).then(
      (data) => {
        if (cancelled) return;
        const remembered = loadLastPage(data.manifest.lectureId);
        setPage(Math.min(Math.max(remembered ?? 1, 1), data.doc.numPages));
        setLoaded(data);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(
          `${err instanceof Error ? err.message : String(err)}. ` +
            "Check the folder, then press Option+3 for the library.",
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [root, path]);

  useEffect(() => {
    if (loaded) saveLastPage(loaded.manifest.lectureId, page);
  }, [loaded, page]);

  // A page change clears everything that pointed at the page that just left.
  useEffect(() => {
    setFocusNoteId(null);
    setHoverNoteId(null);
    setHoverLine(null);
    setFocusTermId(null);
    setHoverTermId(null);
    setExtras({});
  }, [page]);

  useEffect(() => {
    if (transient === null) return;
    const timer = setTimeout(() => setTransient(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [transient]);

  const pageCount = loaded?.doc.numPages ?? 0;

  const goTo = useCallback(
    (next: number) => {
      setPage((current) => {
        const clamped = Math.min(Math.max(next, 1), Math.max(pageCount, 1));
        return clamped === current ? current : clamped;
      });
    },
    [pageCount],
  );

  const notes = useMemo<Note[]>(
    () => notesOnPage(loaded?.notes ?? null, page),
    [loaded, page],
  );
  const noted = useMemo(() => pagesWithNotes(loaded?.notes ?? null), [loaded]);
  const referenced = useMemo(() => new Set(referencedLines(notes)), [notes]);

  const spansPage = useMemo<SpanPage | null>(
    () => loaded?.spans?.pages.find((p) => p.page === page) ?? null,
    [loaded, page],
  );
  const termPage = useMemo<TermPage | null>(
    () => loaded?.terms?.pages.find((p) => p.page === page) ?? null,
    [loaded, page],
  );
  const terms = useMemo<Term[]>(() => termPage?.terms ?? [], [termPage]);

  /* Highlight to explain works in review too: select a phrase, press `e`. */
  const setKeyMode = useSetKeyMode();
  const textHost = useRef<TextLayerHost | null>(null);
  const watcher = useRef<SelectionWatcher | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const onSelection = useRef<(selection: LookupSelection | null) => void>(() => {});
  const anchorsRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<SlideGeometry | null>(null);
  const [slideRect, setSlideRect] = useState<Rect | null>(null);

  const onTextLayer = useCallback((host: TextLayerHost) => {
    textHost.current = host;
  }, []);

  useEffect(() => {
    const created = new SelectionWatcher({
      index: () => textHost.current,
      page: () => pageRef.current,
      onChange: (selection) => onSelection.current(selection),
    });
    created.start();
    watcher.current = created;
    return () => {
      created.stop();
      watcher.current = null;
    };
  }, []);

  const readSelection = useCallback(() => watcher.current?.read() ?? null, []);

  const lookup = useLookup({
    page,
    spans: loaded?.spans ?? null,
    terms: loaded?.terms ?? null,
    readSelection,
    setKeyMode,
  });
  onSelection.current = lookup.noteSelection;

  useLayoutEffect(() => {
    if (!lookup.card) return;
    const el = anchorsRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSlideRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }, [lookup.card, geometry]);

  const anchorRect =
    lookup.card && lookup.highlight && slideRect && spansPage
      ? firstLineRect(spansPage, lookup.highlight.lineIds, slideRect)
      : null;

  /*
   * The dark-deck switch (ui-direction.md §E). The canvas is sampled once per
   * lecture, on the first page that finishes drawing, and the answer is
   * stamped on the stage so the anchor layer can pick its blend mode.
   */
  useEffect(() => {
    if (!loaded) return;
    const id = loaded.manifest.lectureId;
    const stage = (): HTMLElement | null =>
      anchorsRef.current?.closest<HTMLElement>('[data-testid="slide"]') ?? null;

    const remembered = rememberedDeck(id);
    if (remembered !== undefined) {
      const el = stage();
      if (el) el.dataset["deck"] = remembered ? "dark" : "light";
      return;
    }

    let cancelled = false;
    let tries = 0;
    const tick = (): void => {
      if (cancelled) return;
      const el = stage();
      const canvas = el?.querySelector("canvas") ?? null;
      const mean = canvas === null ? null : sampleCanvasLuminance(canvas);
      if (mean === null) {
        tries += 1;
        if (tries < 120) requestAnimationFrame(tick);
        return;
      }
      const dark = isDarkDeck(mean);
      rememberDeck(id, dark);
      if (el) el.dataset["deck"] = dark ? "dark" : "light";
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [loaded, geometry]);

  /* Reciprocity. One pair of ids drives both directions (ui-direction.md §E). */
  const hoverTerm = useMemo<Term | null>(() => {
    const id = hoverTermId ?? focusTermId;
    return id === null ? null : (terms.find((t) => t.id === id) ?? null);
  }, [hoverTermId, focusTermId, terms]);

  const refs = useMemo<AnchorRef[]>(() => {
    const out: AnchorRef[] = [];
    for (const note of notes) {
      if (note.lineIds.length === 0) continue;
      const state: AnchorState =
        note.id === focusNoteId
          ? "active"
          : note.id === hoverNoteId ||
              (hoverLine !== null && note.lineIds.includes(hoverLine))
            ? "hover"
            : "resting";
      out.push({
        id: note.id,
        lineIds: note.lineIds,
        state,
        mine: note.kind === "student",
      });
    }
    if (hoverTerm && hoverTerm.lineIds.length > 0) {
      out.push({ id: `t:${hoverTerm.id}`, lineIds: hoverTerm.lineIds, state: "hover" });
    }
    if (lookup.highlight) {
      out.push({
        id: "lookup",
        lineIds: lookup.highlight.lineIds,
        state: lookup.highlight.state === "active" ? "active" : "hover",
      });
    }
    return out;
  }, [notes, focusNoteId, hoverNoteId, hoverLine, hoverTerm, lookup.highlight]);

  const linkedIds = useMemo(() => {
    const out = new Set<string>();
    if (hoverLine === null) return out;
    for (const note of notes) {
      if (note.lineIds.includes(hoverLine)) out.add(note.id);
    }
    return out;
  }, [notes, hoverLine]);

  /** Hit testing on the stage: no listener per box, the layer takes no events. */
  const onPointerMove = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const el = anchorsRef.current;
      if (!el || !spansPage || referenced.size === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || spansPage.width <= 0) return;
      const k = rect.width / spansPage.width;
      const found = lineAtPoint(
        spansPage.lines,
        referenced,
        (ev.clientX - rect.left) / k,
        (ev.clientY - rect.top) / k,
      );
      setHoverLine((current) => (current === found ? current : found));
    },
    [spansPage, referenced],
  );

  const noteEls = useRef(new Map<string, HTMLDivElement>());
  const registerNote = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el === null) noteEls.current.delete(id);
    else noteEls.current.set(id, el);
  }, []);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (notes.length === 0) return;
      const at = focusNoteId === null ? null : notes.findIndex((n) => n.id === focusNoteId);
      // Nothing focused yet: `j` takes the top of the rail, `k` the bottom.
      const next =
        at === null || at < 0
          ? delta === 1
            ? 0
            : notes.length - 1
          : Math.min(notes.length - 1, Math.max(0, at + delta));
      const target = notes[next];
      if (target) noteEls.current.get(target.id)?.focus();
    },
    [notes, focusNoteId],
  );

  const isOpen = useCallback(
    (note: Note) => extras[note.id] ?? note.kind === "student",
    [extras],
  );

  const toggleNote = useCallback(
    (id: string) => {
      const note = notes.find((n) => n.id === id);
      if (!note) return;
      const current = extras[id] ?? note.kind === "student";
      setExtras((prev) => ({ ...prev, [id]: !current }));
    },
    [notes, extras],
  );

  const toggleGlossary = useCallback(() => {
    setGlossaryOpen((open) => {
      saveGlossaryOpen(!open);
      return !open;
    });
  }, []);

  const openObsidian = useCallback(() => {
    const file = loaded?.markdownPath ?? null;
    if (file === null) {
      setTransient(`open ${lectureId}.md in Obsidian; ${OBSIDIAN_UNAVAILABLE}`);
      return;
    }
    window.open(`obsidian://open?path=${encodeURIComponent(file)}`);
  }, [loaded, lectureId]);

  useKeyActions((action) => {
    switch (action.type) {
      case "nextSlide":
        goTo(page + 1);
        break;
      case "prevSlide":
        goTo(page - 1);
        break;
      case "jumpSlide":
        if (action.slide > pageCount) setTransient(`this deck ends at ${pageCount}`);
        else goTo(action.slide);
        break;
      case "digitsChanged":
        setDigits(action.digits);
        break;
      case "nextNotedPage": {
        const next = nextPageWithNotes(noted, page);
        if (next !== null) goTo(next);
        break;
      }
      case "prevNotedPage": {
        const previous = prevPageWithNotes(noted, page);
        if (previous !== null) goTo(previous);
        break;
      }
      case "focusNext":
        step(1);
        break;
      case "focusPrev":
        step(-1);
        break;
      case "activate":
        if (focusTermId !== null) lookup.showTerm(focusTermId);
        else if (focusNoteId !== null) toggleNote(focusNoteId);
        else lookup.activate();
        break;
      case "toggleGlossary":
        toggleGlossary();
        break;
      case "openObsidian":
        openObsidian();
        break;
      case "reexport":
        setTransient(EXPORT_MESSAGE);
        break;
      case "explainSelection":
        lookup.explain();
        break;
      case "cycleTerm":
        lookup.cycle(action.direction);
        break;
      case "closeCard":
        lookup.close();
        break;
      default:
        break;
    }
  });

  if (error) {
    return (
      <div className={styles["screen"]}>
        <div className={styles["message"]}>
          <p>{error}</p>
          <button type="button" onClick={() => navigate({ kind: "library" })}>
            Back to the library
          </button>
        </div>
      </div>
    );
  }

  const manifest = loaded?.manifest;
  const courseLabel = manifest?.courseTitle ?? manifest?.course ?? course;
  const lectureLabel =
    manifest?.number === undefined ? "" : `Lec ${String(manifest.number).padStart(2, "0")}`;
  const title = manifest?.title ?? lectureId;
  const openQuestions =
    loaded?.notes && page === lastPageWithNotes(noted) ? loaded.notes.openQuestions : [];
  const headerMessage =
    digits !== "" ? `${digits}_` : (transient ?? lookup.message ?? lookup.cursorText);

  return (
    <div className={styles["screen"]}>
      <header className={styles["header"]} data-testid="review-header">
        <div className={styles["heading"]}>
          <span className={styles["course"]}>{courseLabel}</span>
          <span className={styles["sep"]} aria-hidden="true" />
          <span className={styles["lecture"]}>{lectureLabel}</span>
          <span className={styles["title"]}>{title}</span>
        </div>
        <div className={styles["status"]}>
          {loaded?.markdownPath != null && (
            <button
              type="button"
              className={styles["textButton"]}
              data-testid="open-obsidian"
              onClick={openObsidian}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") ev.stopPropagation();
              }}
            >
              Open in Obsidian
            </button>
          )}
          {headerMessage != null && (
            <span className={styles["headerMessage"]} data-testid="review-message">
              {headerMessage}
            </span>
          )}
          <span className={styles["counter"]} data-testid="review-counter">
            {page}/{pageCount}
          </span>
        </div>
      </header>

      <div className={styles["body"]}>
        <div
          className={styles["slidePane"]}
          data-testid="review-slide-pane"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHoverLine(null)}
        >
          {loaded ? (
            <SlideStage
              doc={loaded.doc}
              pageNumber={page}
              dim={1}
              spans={loaded.spans}
              onTextLayer={onTextLayer}
              onGeometry={setGeometry}
            >
              <div ref={anchorsRef} className={styles["anchors"]}>
                <AnchorLayer spans={spansPage} refs={refs} width={geometry?.width ?? 0} />
              </div>
            </SlideStage>
          ) : (
            <div className={styles["message"]}>
              <p>Opening the deck.</p>
            </div>
          )}
        </div>

        <NoteRail
          notes={notes}
          openQuestions={openQuestions}
          focusId={focusNoteId}
          linkedIds={linkedIds}
          isOpen={isOpen}
          onFocusNote={setFocusNoteId}
          onHoverNote={setHoverNoteId}
          onToggleNote={toggleNote}
          registerNote={registerNote}
        >
          <GlossaryPanel
            open={glossaryOpen}
            terms={terms}
            focusId={focusTermId}
            onToggle={toggleGlossary}
            onHover={setHoverTermId}
            onFocus={setFocusTermId}
            onOpenTerm={lookup.showTerm}
          />
        </NoteRail>
      </div>

      {lookup.card && anchorRect && slideRect && (
        <LookupCard
          result={lookup.card}
          anchor={anchorRect}
          slide={slideRect}
          onPickTerm={lookup.showTerm}
        />
      )}
    </div>
  );
}
