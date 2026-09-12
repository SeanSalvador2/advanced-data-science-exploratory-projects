import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  EventSchema,
  LectureManifestSchema,
  TermIndexSchema,
  type Event,
  type LectureManifest,
  type LookupSelection,
  type SpanIndex,
  type SpanPage,
  type TermIndex,
} from "@lecture/core";

import { AnchorLayer } from "../../anchors/AnchorLayer.tsx";
import { NoteCapture } from "../../components/NoteCapture.tsx";
import { StatusStrip, type StripItem } from "../../components/StatusStrip.tsx";
import { EventBuffer } from "../../events/EventBuffer.ts";
import { nowIso } from "../../events/time.ts";
import { useKeyActions, useSetKeyMode } from "../../keys/useKeys.ts";
import {
  classifyHeartbeat,
  HEARTBEAT_FILE,
  parseHeartbeat,
  recorderText,
  type RecorderState,
} from "../../lib/heartbeat.ts";
import { LookupCard } from "../../lookup/LookupCard.tsx";
import { firstLineRect, type Rect } from "../../lookup/position.ts";
import { useLookup } from "../../lookup/useLookup.ts";
import { loadDocument, type PDFDocumentProxy } from "../../pdf/index.ts";
import type { TextLayerHost } from "../../pdf/TextLayerHost.ts";
import { SelectionWatcher } from "../../selection/SelectionWatcher.ts";
import {
  clampDim,
  DIM_STEP,
  loadLastPage,
  saveDim,
  saveLastPage,
} from "../../state/persist.ts";
import { folderPath, navigate } from "../../state/routes.ts";
import type { LectureFolder } from "../../storage/LectureFolder.ts";

import { SlideStage, type SlideGeometry } from "./SlideStage.tsx";
import styles from "./Lecture.module.css";

/** The heartbeat is written every 2 s, so it is read at the same rate. */
const HEARTBEAT_POLL_MS = 2000;
const TRANSIENT_MS = 2400;

interface Loaded {
  folder: LectureFolder;
  manifest: LectureManifest;
  doc: PDFDocumentProxy;
  spans: SpanIndex | null;
  terms: TermIndex | null;
  noteCount: number;
  startPage: number;
}

/** Count the notes already in `events.jsonl`, ignoring malformed lines. */
function countNotes(text: string): number {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = EventSchema.safeParse(JSON.parse(line));
      if (parsed.success && parsed.data.type === "note") count += 1;
    } catch {
      // A half-written line from a crash. It is not a note we can count.
    }
  }
  return count;
}

export interface LectureProps {
  root: LectureFolder;
  course: string;
  lectureId: string;
  dim: number;
  onDim: (dim: number) => void;
}

/**
 * Lecture mode. The resting screen is the slide and a 28 px strip, nothing
 * else: every affordance is invisible until it is asked for and gone when it
 * is done (ui-direction.md §A).
 */
export function Lecture({
  root,
  course,
  lectureId,
  dim,
  onDim,
}: LectureProps): React.JSX.Element {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [noteCount, setNoteCount] = useState(0);
  const [noteText, setNoteText] = useState<string | null>(null);
  const [digits, setDigits] = useState("");
  const [recorder, setRecorder] = useState<RecorderState>({ kind: "none" });
  const [transient, setTransient] = useState<string | null>(null);

  const buffer = useRef<EventBuffer | null>(null);
  /** The last `{lectureId, page}` written, so no page is logged twice in a row. */
  const lastSlideWritten = useRef<string | null>(null);
  const noteTextRef = useRef<string | null>(null);
  noteTextRef.current = noteText;

  const path = folderPath(course, lectureId);

  // Load the folder once per lecture.
  useEffect(() => {
    let cancelled = false;
    setLoaded(null);
    setError(null);

    void (async () => {
      try {
        const folder = await root.subfolder(path);
        if (!folder) throw new Error(`there is no folder ${path} in this vault`);
        const rawManifest = await folder.readJson<unknown>("lecture.json");
        const parsed = LectureManifestSchema.safeParse(rawManifest);
        if (!parsed.success) {
          throw new Error(`${path}/lecture.json is missing or is not a lecture manifest`);
        }
        const manifest = parsed.data;

        const bytes = await folder.readBinary("deck.pdf");
        const doc = await loadDocument(bytes);
        const spans = await folder.readJson<SpanIndex>("spans.json").catch(() => null);
        const rawTerms = await folder.readJson<unknown>("terms.json").catch(() => null);
        // A malformed index is the same as no index: the card would have
        // nothing trustworthy to show.
        const parsedTerms = rawTerms === null ? null : TermIndexSchema.safeParse(rawTerms);
        const terms = parsedTerms?.success ? parsedTerms.data : null;

        let existingNotes = 0;
        try {
          const raw = await folder.readBinary("events.jsonl");
          existingNotes = countNotes(new TextDecoder().decode(raw));
        } catch {
          // No events yet. The first slide event will create the file.
        }

        const remembered = loadLastPage(manifest.lectureId);
        const startPage = Math.min(Math.max(remembered ?? 1, 1), doc.numPages);

        if (cancelled) return;
        buffer.current?.dispose();
        const eventBuffer = new EventBuffer({ folder });
        eventBuffer.attach();
        buffer.current = eventBuffer;

        setNoteCount(existingNotes);
        setPage(startPage);
        setLoaded({ folder, manifest, doc, spans, terms, noteCount: existingNotes, startPage });
      } catch (err) {
        if (cancelled) return;
        setError(
          `${err instanceof Error ? err.message : String(err)}. ` +
            "Check the folder, then press Option+3 for the library.",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [root, path]);

  useEffect(
    () => () => {
      const current = buffer.current;
      buffer.current = null;
      if (current) {
        void current.flush().finally(() => current.dispose());
      }
    },
    [],
  );

  /**
   * Every page the student lands on is an event, the first one included: the
   * recorder's `start` must be followed by a known slide or the transcriber
   * has no window for page one (architecture.md §4.4).
   */
  useEffect(() => {
    if (!loaded) return;
    // React's strict mode runs mount effects twice, and a re-render must not
    // duplicate an event either. Only a *change* of page is an event, which is
    // also why 1 -> 2 -> 1 still writes three of them.
    const stamp = `${loaded.manifest.lectureId}#${page}`;
    if (lastSlideWritten.current === stamp) return;
    lastSlideWritten.current = stamp;
    const event: Event = { wall: nowIso(), type: "slide", slide: page, source: "app" };
    buffer.current?.enqueue(event);
    void buffer.current?.flush();
    saveLastPage(loaded.manifest.lectureId, page);
  }, [loaded, page]);

  // The heartbeat file, polled through the adapter, plus a one-second tick so
  // "live" turns into "stale" without waiting for the next read.
  useEffect(() => {
    if (!loaded) return;
    let stopped = false;
    let latest: ReturnType<typeof parseHeartbeat> = null;

    const read = async (): Promise<void> => {
      const raw = await loaded.folder.readJson<unknown>(HEARTBEAT_FILE).catch(() => null);
      if (stopped) return;
      latest = parseHeartbeat(raw);
      setRecorder(classifyHeartbeat(latest));
    };

    void read();
    const poll = setInterval(() => void read(), HEARTBEAT_POLL_MS);
    const tick = setInterval(() => {
      if (!stopped) setRecorder(classifyHeartbeat(latest));
    }, 1000);
    return () => {
      stopped = true;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [loaded]);

  useEffect(() => {
    if (transient === null) return;
    const timer = setTimeout(() => setTransient(null), TRANSIENT_MS);
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

  /*
   * Highlight to explain. The watcher is the only `selectionchange` listener
   * in the app; it hands a resolved `{page, beginItem..endItem}` to the pure
   * lookup in core, and `useLookup` holds the card, the term cursor and the
   * one highlight that may be lit at a time (architecture.md §7).
   */
  const setKeyMode = useSetKeyMode();
  const textHost = useRef<TextLayerHost | null>(null);
  const watcher = useRef<SelectionWatcher | null>(null);
  const pageRef = useRef(page);
  pageRef.current = page;
  const onSelection = useRef<(selection: LookupSelection | null) => void>(() => {});
  const overlayRef = useRef<HTMLDivElement>(null);
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

  const spansPage = useMemo<SpanPage | null>(
    () => loaded?.spans?.pages.find((p) => p.page === page) ?? null,
    [loaded, page],
  );

  const lookup = useLookup({
    page,
    spans: loaded?.spans ?? null,
    terms: loaded?.terms ?? null,
    readSelection,
    setKeyMode,
  });
  onSelection.current = lookup.noteSelection;

  // The card is placed against the slide box in viewport pixels, so the box is
  // measured when the card opens and again whenever the page is re-laid out.
  useLayoutEffect(() => {
    if (!lookup.card) return;
    const el = overlayRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSlideRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
  }, [lookup.card, geometry]);

  const anchorRect =
    lookup.card && lookup.highlight && slideRect && spansPage
      ? firstLineRect(spansPage, lookup.highlight.lineIds, slideRect)
      : null;

  const commitNote = useCallback(() => {
    const text = (noteTextRef.current ?? "").trim();
    setNoteText(null);
    if (text === "") return;
    buffer.current?.enqueue({ wall: nowIso(), type: "note", text, source: "app" });
    setNoteCount((c) => c + 1);
  }, []);

  useKeyActions((action) => {
    switch (action.type) {
      case "nextSlide":
        goTo(page + 1);
        break;
      case "prevSlide":
        goTo(page - 1);
        break;
      case "jumpSlide":
        if (action.slide > pageCount) {
          setTransient(`this deck ends at ${pageCount}`);
        } else {
          goTo(action.slide);
        }
        break;
      case "digitsChanged":
        setDigits(action.digits);
        break;
      case "openNote":
        setNoteText("");
        break;
      case "commitNote":
        commitNote();
        break;
      case "cancelNote":
        setNoteText(null);
        break;
      case "dim": {
        const next = clampDim(dim + action.delta * DIM_STEP);
        onDim(next);
        saveDim(next);
        break;
      }
      case "explainSelection":
        lookup.explain();
        break;
      case "cycleTerm":
        lookup.cycle(action.direction);
        break;
      case "activate":
        lookup.activate();
        break;
      case "closeCard":
        lookup.close();
        break;
      default:
        break;
    }
  });

  const items = useMemo<StripItem[]>(() => {
    const out: StripItem[] = [
      { key: "slide", text: `${page}/${pageCount}`, tone: "ink" },
      {
        key: "recorder",
        text: recorderText(recorder),
        tone: recorder.kind === "stale" ? "stale" : "muted",
      },
      { key: "notes", text: `${noteCount} notes` },
    ];
    if (loaded && !loaded.terms) out.push({ key: "index", text: "no index" });
    if (digits !== "") out.push({ key: "digits", text: `→ ${digits}_`, tone: "ink" });
    if (lookup.cursorText !== null) out.push({ key: "cursor", text: lookup.cursorText, tone: "ink" });
    if (lookup.message !== null) out.push({ key: "lookup", text: lookup.message });
    if (transient !== null) out.push({ key: "transient", text: transient });
    return out;
  }, [
    page,
    pageCount,
    recorder,
    noteCount,
    loaded,
    digits,
    transient,
    lookup.cursorText,
    lookup.message,
  ]);

  if (error) {
    return (
      <div className={styles["screen"]}>
        <div className={styles["message"]}>
          <p>{error}</p>
          <button type="button" onClick={() => navigate({ kind: "library" })}>
            Back to the library
          </button>
        </div>
        <StatusStrip items={[{ key: "state", text: "not open" }]} mode="lecture" />
      </div>
    );
  }

  return (
    <div className={styles["screen"]} style={{ ["--dim" as string]: String(dim) }}>
      {loaded ? (
        <SlideStage
          doc={loaded.doc}
          pageNumber={page}
          dim={dim}
          spans={loaded.spans}
          onTextLayer={onTextLayer}
          onGeometry={setGeometry}
        >
          <div ref={overlayRef} className={styles["anchors"]}>
            <AnchorLayer
              spans={spansPage}
              lineIds={lookup.highlight?.lineIds ?? []}
              state={lookup.highlight?.state ?? "hover"}
              refId={lookup.card?.kind}
              width={geometry?.width ?? 0}
            />
          </div>
        </SlideStage>
      ) : (
        <div className={styles["message"]}>
          <p>Opening the deck.</p>
        </div>
      )}
      {lookup.card && anchorRect && slideRect && (
        <LookupCard
          result={lookup.card}
          anchor={anchorRect}
          slide={slideRect}
          onPickTerm={lookup.showTerm}
        />
      )}
      {noteText !== null && <NoteCapture value={noteText} onChange={setNoteText} />}
      <StatusStrip items={items} mode="lecture" />
    </div>
  );
}
