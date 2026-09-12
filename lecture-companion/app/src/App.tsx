import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommandPalette, type PaletteCommand } from "./components/CommandPalette.tsx";
import { KeymapOverlay } from "./components/KeymapOverlay.tsx";
import {
  bindKeyRouter,
  KeyRouter,
  type KeyAction,
  type KeyMode,
  type KeyScope,
} from "./keys/KeyRouter.ts";
import { KeyActionsContext, KeyModeContext, type KeyHandler } from "./keys/useKeys.ts";
import { flatten, scanLibrary, type LectureEntry } from "./lib/library.ts";
import { Library } from "./screens/library/Library.tsx";
import { Lecture } from "./screens/lecture/Lecture.tsx";
import { Review } from "./screens/review/Review.tsx";
import { VaultGate } from "./screens/VaultGate.tsx";
import {
  applyTheme,
  DIM_DARK_DEFAULT,
  effectiveTheme,
  loadDim,
  loadThemeSetting,
  saveThemeSetting,
  type ThemeSetting,
} from "./state/persist.ts";
import { navigate, parseRoute, type Route } from "./state/routes.ts";
import { chooseVault, reopenVault, restoreVault, type VaultStatus } from "./state/vault.ts";

/**
 * Everything the palette can run on the screen that is showing, in the order
 * it is offered before a query narrows it: what this screen does, then the
 * global moves, then one entry per lecture in the vault.
 *
 * Every command here is something the keyboard can already do (the `keys`
 * column says which key), or a navigation the keyboard cannot express — an
 * "open this exact lecture" that no chord could name. That is the whole point
 * of the surface: it is the discovery list for the keymap as well as a way to
 * reach a lecture by typing its title (ui-direction.md §D).
 */
function buildCommands(
  route: Route,
  lectures: LectureEntry[] | null,
  run: (action: KeyAction, mode?: KeyMode) => void,
  open: (course: string, lectureId: string, review: boolean) => void,
): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const add = (id: string, title: string, keys: string | undefined, act: () => void): void => {
    out.push({ id, title, ...(keys === undefined ? {} : { keys }), run: act });
  };
  const slides = route.kind === "lecture" || route.kind === "review";

  if (slides) {
    add("next-slide", "Next slide", "Right", () => run({ type: "nextSlide" }));
    add("prev-slide", "Previous slide", "Left", () => run({ type: "prevSlide" }));
    add("explain", "Explain the selection", "e", () => run({ type: "explainSelection" }));
    add("next-term", "Next term on this slide", "t", () =>
      run({ type: "cycleTerm", direction: 1 }),
    );
    add("prev-term", "Previous term on this slide", "Shift+T", () =>
      run({ type: "cycleTerm", direction: -1 }),
    );
  }
  if (route.kind === "lecture") {
    add("note", "Type a note", "n", () => run({ type: "openNote" }, "noteInput"));
    add("dim", "Dim slide", "-", () => run({ type: "dim", delta: -1 }));
    add("brighten", "Brighten slide", "=", () => run({ type: "dim", delta: 1 }));
  }
  if (route.kind === "review") {
    add("next-note", "Next note", "j", () => run({ type: "focusNext" }));
    add("prev-note", "Previous note", "k", () => run({ type: "focusPrev" }));
    add("glossary", "Toggle the glossary", "g", () => run({ type: "toggleGlossary" }));
    add("next-noted", "Next slide that has notes", "]", () => run({ type: "nextNotedPage" }));
    add("prev-noted", "Previous slide that has notes", "[", () => run({ type: "prevNotedPage" }));
    add("obsidian", "Open this lecture in Obsidian", "o", () => run({ type: "openObsidian" }));
    add("reexport", "How to re-export the Markdown", "Option+E", () => run({ type: "reexport" }));
  }
  if (route.kind === "library") {
    add("next-row", "Next lecture", "j", () => run({ type: "focusNext" }));
    add("prev-row", "Previous lecture", "k", () => run({ type: "focusPrev" }));
    add("open-row", "Open the lecture under the cursor", "Enter", () => run({ type: "activate" }));
  }
  if (route.kind !== "lecture") {
    add("go-lecture", "Go to lecture mode", "Option+1", () =>
      run({ type: "switchMode", target: "lecture" }),
    );
  }
  if (route.kind !== "review") {
    add("go-review", "Go to review mode", "Option+2", () =>
      run({ type: "switchMode", target: "review" }),
    );
  }
  if (route.kind !== "library") {
    add("go-library", "Go to library", "Option+3", () =>
      run({ type: "switchMode", target: "library" }),
    );
  }
  add("theme", "Switch theme", "Option+T", () => run({ type: "toggleTheme" }));
  add("keys", "Show keys", "?", () => run({ type: "openKeymap" }, "palette"));
  add("rescan", "Rescan library", "r", () => run({ type: "rescan" }));

  for (const entry of lectures ?? []) {
    const name = entry.manifest.title ?? entry.lectureId;
    const where = `${entry.course} ${entry.lectureId}`;
    add(`open-lecture-${entry.course}-${entry.lectureId}`, `Open lecture ${name}`, where, () =>
      open(entry.course, entry.lectureId, false),
    );
    if (entry.hasNotes) {
      add(`open-review-${entry.course}-${entry.lectureId}`, `Open review ${name}`, where, () =>
        open(entry.course, entry.lectureId, true),
      );
    }
  }
  return out;
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = (): void => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onHash);
    if (location.hash === "") location.replace("#/library");
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return route;
}

/**
 * The shell: one route, one theme, one keyboard listener, one keymap overlay.
 * Screens subscribe to key actions through `useKeyActions`; nothing else in the
 * app listens for `keydown`.
 */
export function App(): React.JSX.Element {
  const route = useHashRoute();
  const [vault, setVault] = useState<VaultStatus>({ kind: "loading" });
  const [themeSetting, setThemeSetting] = useState<ThemeSetting>(loadThemeSetting);
  const [dim, setDim] = useState(() => loadDim(DIM_DARK_DEFAULT));
  const [keymapOpen, setKeymapOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** The palette's lecture entries. Null until the palette is first opened. */
  const [lectures, setLectures] = useState<LectureEntry[] | null>(null);

  const router = useMemo(() => new KeyRouter({ scope: "library" }), []);
  const screenHandler = useRef<KeyHandler | null>(null);
  const lastLecture = useRef<{ course: string; lectureId: string } | null>(null);

  useEffect(() => {
    void restoreVault().then(setVault);
  }, []);

  const theme = effectiveTheme(themeSetting, route.kind);
  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    if (route.kind !== "library") lastLecture.current = { course: route.course, lectureId: route.lectureId };
  }, [route]);

  useEffect(() => {
    const scope: KeyScope = route.kind === "library" ? "library" : route.kind;
    router.setScope(scope);
    setKeymapOpen(false);
    setPaletteOpen(false);
  }, [route.kind, router]);

  /**
   * The vault is walked for the palette's lecture entries, and only when the
   * palette is first opened: a lecture is not the moment to start a directory
   * walk nobody asked for. "Rescan library" walks it again.
   */
  const scanForPalette = useCallback(() => {
    if (vault.kind !== "ready") return;
    scanLibrary(vault.root).then(
      (groups) => setLectures(flatten(groups)),
      () => setLectures([]),
    );
  }, [vault]);

  const register = useCallback((handler: KeyHandler) => {
    screenHandler.current = handler;
    return () => {
      if (screenHandler.current === handler) screenHandler.current = null;
    };
  }, []);

  const dispatch = useCallback(
    (action: KeyAction) => {
      switch (action.type) {
        case "switchMode": {
          if (action.target === "library") {
            navigate({ kind: "library" });
            return;
          }
          const target = lastLecture.current;
          if (!target) {
            navigate({ kind: "library" });
            return;
          }
          navigate({ kind: action.target, ...target });
          return;
        }
        case "toggleTheme": {
          const next: ThemeSetting = theme === "dark" ? "light" : "dark";
          setThemeSetting(next);
          saveThemeSetting(next);
          return;
        }
        case "openKeymap":
          setKeymapOpen(true);
          return;
        case "openPalette":
          setPaletteOpen(true);
          if (lectures === null) scanForPalette();
          return;
        // Both palette-mode surfaces close together. Only one is ever open, and
        // Esc has to leave the keyboard where the FSM says it is either way.
        case "closeKeymap":
        case "closePalette":
          setKeymapOpen(false);
          setPaletteOpen(false);
          return;
        case "rescan":
          scanForPalette();
          screenHandler.current?.(action);
          return;
        default:
          screenHandler.current?.(action);
      }
    },
    [theme, lectures, scanForPalette],
  );

  useEffect(() => bindKeyRouter(router, dispatch), [router, dispatch]);

  const setKeyMode = useCallback((mode: KeyMode) => router.setMode(mode), [router]);

  const closeOverlays = useCallback(() => {
    setKeymapOpen(false);
    setPaletteOpen(false);
    router.setMode("idle");
  }, [router]);

  /**
   * Run one command from the palette. `mode` is the FSM state the equivalent
   * keystroke would have left behind — `n` puts the router in `noteInput`, and
   * a note field the router thinks it is not in would eat every letter as a
   * shortcut.
   */
  const runCommand = useCallback(
    (action: KeyAction, mode?: KeyMode) => {
      dispatch(action);
      if (mode !== undefined) router.setMode(mode);
    },
    [dispatch, router],
  );

  const openLecture = useCallback((course: string, lectureId: string, review: boolean) => {
    navigate({ kind: review ? "review" : "lecture", course, lectureId });
  }, []);

  const commands = useMemo(
    () => buildCommands(route, lectures, runCommand, openLecture),
    [route, lectures, runCommand, openLecture],
  );

  let screen: React.JSX.Element;
  if (vault.kind === "loading") {
    screen = <main />;
  } else if (vault.kind !== "ready") {
    screen = (
      <VaultGate
        kind={vault.kind}
        message={vault.kind === "error" ? vault.message : undefined}
        onChoose={() => void chooseVault().then(setVault)}
        onReopen={() => void reopenVault().then(setVault)}
      />
    );
  } else if (route.kind === "library") {
    screen = <Library root={vault.root} />;
  } else if (route.kind === "review") {
    screen = (
      <Review
        key={`${route.course}/${route.lectureId}`}
        root={vault.root}
        course={route.course}
        lectureId={route.lectureId}
      />
    );
  } else {
    screen = (
      <Lecture
        key={`${route.course}/${route.lectureId}`}
        root={vault.root}
        course={route.course}
        lectureId={route.lectureId}
        dim={dim}
        onDim={setDim}
      />
    );
  }

  return (
    <KeyActionsContext.Provider value={register}>
      <KeyModeContext.Provider value={setKeyMode}>
        {screen}
        <KeymapOverlay open={keymapOpen} onClose={closeOverlays} />
        <CommandPalette open={paletteOpen} commands={commands} onClose={closeOverlays} />
      </KeyModeContext.Provider>
    </KeyActionsContext.Provider>
  );
}
