import { createContext, useContext, useEffect, useRef } from "react";

import type { KeyAction } from "./KeyRouter.ts";

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
