import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { KeymapOverlay } from "./components/KeymapOverlay.tsx";
import {
  bindKeyRouter,
  KeyRouter,
  type KeyAction,
  type KeyMode,
  type KeyScope,
} from "./keys/KeyRouter.ts";
import { KeyActionsContext, KeyModeContext, type KeyHandler } from "./keys/useKeys.ts";
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
  }, [route.kind, router]);

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
        case "closeKeymap":
          setKeymapOpen(false);
          return;
        default:
          screenHandler.current?.(action);
      }
    },
    [theme],
  );

  useEffect(() => bindKeyRouter(router, dispatch), [router, dispatch]);

  const setKeyMode = useCallback((mode: KeyMode) => router.setMode(mode), [router]);

  const closeKeymap = useCallback(() => {
    setKeymapOpen(false);
    router.setMode("idle");
  }, [router]);

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
        <KeymapOverlay open={keymapOpen} onClose={closeKeymap} />
      </KeyModeContext.Provider>
    </KeyActionsContext.Provider>
  );
}
