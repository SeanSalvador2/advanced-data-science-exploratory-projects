import { createContext, useContext, useEffect, useRef } from "react";

import type { KeyAction, KeyMode } from "./KeyRouter.ts";

export type KeyHandler = (action: KeyAction) => void;

/** Registers the active screen's handler; the shell keeps the only listener. */
export const KeyActionsContext = createContext<(handler: KeyHandler) => () => void>(() => () => {});

/**
 * Subscribe the current screen to key actions. Only one screen is mounted at a
 * time, so this is a single slot rather than a broadcast, and the handler is
 * read through a ref so a screen re-render does not re-register it.
 */
export function useKeyActions(handler: KeyHandler): void {
  const register = useContext(KeyActionsContext);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => register((action) => ref.current(action)), [register]);
}

/**
 * The router's mode, for the state the router cannot see: a card opened by a
 * mouse selection, or a term cursor that Esc must still pop. The shell owns
 * the router, so a screen reaches it through here rather than by sniffing the
 * active element (anti-pattern 2).
 */
export const KeyModeContext = createContext<(mode: KeyMode) => void>(() => {});

export function useSetKeyMode(): (mode: KeyMode) => void {
  return useContext(KeyModeContext);
}
