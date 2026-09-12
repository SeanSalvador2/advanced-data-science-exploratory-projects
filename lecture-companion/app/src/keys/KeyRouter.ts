/**
 * The keyboard finite state machine from ui-direction.md §D.
 *
 * One `keydown` listener on `window` feeds this router, and this router is the
 * only place `preventDefault` is decided. Bare-letter shortcuts fire only in
 * `idle` and `cardOpen`; `noteInput` and `palette` let every printable key
 * through to whatever has focus. The check is the mode, never
 * `activeElement.tagName` — that is anti-pattern 2.
 *
 * Key facts from phase-2-research.md §4 that constrain this: bare arrows,
 * PageUp/PageDown, Space, Enter, Esc, bare letters and Option+letter are all
 * delivered by Chrome on macOS; Cmd+L/D/F/P/S/R and Cmd+digits are delivered
 * but must not be stolen. Nothing here binds a Cmd combination, and a Cmd or
 * Ctrl chord returns untouched before any other rule runs.
 */

export type KeyMode = "idle" | "numberEntry" | "noteInput" | "cardOpen" | "palette";

/** Which screen is asking. Gates the shortcuts each screen actually has. */
export type KeyScope = "lecture" | "review" | "library";

export type AppMode = "lecture" | "review" | "library";

export type KeyAction =
  | { type: "nextSlide" }
  | { type: "prevSlide" }
  | { type: "jumpSlide"; slide: number }
  | { type: "digitsChanged"; digits: string }
  | { type: "openNote" }
  | { type: "commitNote" }
  | { type: "cancelNote" }
  | { type: "dim"; delta: number }
  | { type: "switchMode"; target: AppMode }
  | { type: "explainSelection" }
  | { type: "cycleTerm"; direction: 1 | -1 }
  | { type: "closeCard" }
  | { type: "openKeymap" }
  | { type: "closeKeymap" }
  | { type: "focusNext" }
  | { type: "focusPrev" }
  | { type: "activate" }
  | { type: "rescan" }
  | { type: "toggleTheme" }
  | { type: "nextNotedPage" }
  | { type: "prevNotedPage" }
  | { type: "toggleGlossary" }
  | { type: "openObsidian" }
  | { type: "reexport" };

/** Just enough of `KeyboardEvent` to be constructed in a unit test. */
export interface KeyEventLike {
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface KeyResult {
  preventDefault: boolean;
  actions: KeyAction[];
}

const NOTHING: KeyResult = { preventDefault: false, actions: [] };

function swallow(...actions: KeyAction[]): KeyResult {
  return { preventDefault: true, actions };
}

function passThrough(...actions: KeyAction[]): KeyResult {
  return { preventDefault: false, actions };
}

/** The slide-moving scopes. Library navigates rows, not pages. */
function movesSlides(scope: KeyScope): boolean {
  return scope === "lecture" || scope === "review";
}

export interface KeyRouterOptions {
  scope?: KeyScope;
  mode?: KeyMode;
}

export class KeyRouter {
  #mode: KeyMode;
  #scope: KeyScope;
  #digits = "";

  constructor(options: KeyRouterOptions = {}) {
    this.#mode = options.mode ?? "idle";
    this.#scope = options.scope ?? "library";
  }

  get mode(): KeyMode {
    return this.#mode;
  }

  get scope(): KeyScope {
    return this.#scope;
  }

  /** The digits typed so far, echoed in the status strip as `→ 14_`. */
  get digits(): string {
    return this.#digits;
  }

  setScope(scope: KeyScope): void {
    if (scope === this.#scope) return;
    this.#scope = scope;
    this.#mode = "idle";
    this.#digits = "";
  }

  /** For state the router does not own: a card opened by a mouse selection. */
  setMode(mode: KeyMode): void {
    this.#mode = mode;
    if (mode !== "numberEntry") this.#digits = "";
  }

  handle(ev: KeyEventLike): KeyResult {
    // Never touch a browser or OS chord. This is the whole of the Cmd policy:
    // no Cmd binding exists in this task, and Cmd+Arrow exists nowhere at all.
    if (ev.metaKey || ev.ctrlKey) return NOTHING;

    // Option combos are global, and `code` is what to read: on macOS Option+1
    // arrives as key "¡" but code "Digit1".
    if (ev.altKey) return this.#handleAlt(ev);

    switch (this.#mode) {
      case "noteInput":
        return this.#handleNoteInput(ev);
      case "numberEntry":
        return this.#handleNumberEntry(ev);
      case "palette":
        return this.#handlePalette(ev);
      case "cardOpen":
        return this.#handleCardOpen(ev);
      case "idle":
        return this.#handleIdle(ev);
    }
  }

  #handleAlt(ev: KeyEventLike): KeyResult {
    const target: AppMode | null =
      ev.code === "Digit1" ? "lecture" : ev.code === "Digit2" ? "review" : ev.code === "Digit3" ? "library" : null;
    if (target) {
      const leaving = this.#leaveCurrentMode();
      this.#mode = "idle";
      this.#digits = "";
      return swallow(...leaving, { type: "switchMode", target });
    }
    if (ev.code === "KeyT") {
      return swallow({ type: "toggleTheme" });
    }
    // Option+E is review's export affordance. The app never writes Markdown,
    // so it only says which command to run (architecture.md §9).
    if (ev.code === "KeyE" && this.#scope === "review") {
      return swallow({ type: "reexport" });
    }
    return NOTHING;
  }

  /** Actions that undo whatever transient state the current mode holds. */
  #leaveCurrentMode(): KeyAction[] {
    switch (this.#mode) {
      case "noteInput":
        return [{ type: "cancelNote" }];
      case "cardOpen":
        return [{ type: "closeCard" }];
      case "palette":
        return [{ type: "closeKeymap" }];
      case "numberEntry":
        return this.#digits === "" ? [] : [{ type: "digitsChanged", digits: "" }];
      case "idle":
        return [];
    }
  }

  /**
   * The input owns the keyboard. Only Enter, Esc and the vertical arrows are
   * intercepted, which is what keeps a bare `n` typed mid-word from reopening
   * the note field.
   */
  #handleNoteInput(ev: KeyEventLike): KeyResult {
    if (ev.key === "Enter") {
      this.#mode = "idle";
      return swallow({ type: "commitNote" });
    }
    if (ev.key === "Escape") {
      this.#mode = "idle";
      return swallow({ type: "cancelNote" });
    }
    // Reserved for note history; intercepted so they never reach the slide.
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") return swallow();
    return NOTHING;
  }

  #handleNumberEntry(ev: KeyEventLike): KeyResult {
    if (ev.key >= "0" && ev.key <= "9" && ev.key.length === 1) {
      this.#digits = (this.#digits + ev.key).slice(0, 4);
      return swallow({ type: "digitsChanged", digits: this.#digits });
    }
    if (ev.key === "Backspace") {
      this.#digits = this.#digits.slice(0, -1);
      if (this.#digits === "") this.#mode = "idle";
      return swallow({ type: "digitsChanged", digits: this.#digits });
    }
    if (ev.key === "Enter") {
      const slide = Number.parseInt(this.#digits, 10);
      this.#digits = "";
      this.#mode = "idle";
      const actions: KeyAction[] = [{ type: "digitsChanged", digits: "" }];
      if (Number.isFinite(slide) && slide >= 1) actions.push({ type: "jumpSlide", slide });
      return swallow(...actions);
    }
    if (ev.key === "Escape") {
      this.#digits = "";
      this.#mode = "idle";
      return swallow({ type: "digitsChanged", digits: "" });
    }
    // Digits, Backspace, Enter, Esc and nothing else.
    return NOTHING;
  }

  #handlePalette(ev: KeyEventLike): KeyResult {
    if (ev.key === "Escape" || ev.key === "?") {
      this.#mode = "idle";
      return swallow({ type: "closeKeymap" });
    }
    // Swallowed in the sense that matters: no bare letter fires behind it.
    return NOTHING;
  }

  /**
   * `cardOpen` is the mode in which Esc has something to pop: the lookup card,
   * and after that the term cursor the card was opened from. Everything else
   * behaves exactly as `idle`.
   */
  #handleCardOpen(ev: KeyEventLike): KeyResult {
    if (ev.key === "Escape") {
      this.#mode = "idle";
      return swallow({ type: "closeCard" });
    }
    if (ev.key === "t" || ev.key === "T") {
      return swallow({ type: "cycleTerm", direction: ev.shiftKey ? -1 : 1 });
    }
    if (ev.key === "e") return swallow({ type: "explainSelection" });
    // Enter opens the card for the term the `t` cursor is on. A chip inside
    // the card stops the event before it reaches this listener, so a focused
    // chip keeps its own Enter (ui-direction.md §D).
    if (ev.key === "Enter") return swallow({ type: "activate" });
    return this.#handleIdle(ev);
  }

  #handleIdle(ev: KeyEventLike): KeyResult {
    const scope = this.#scope;

    if (ev.key === "Escape") return NOTHING;

    if (ev.key === "?") {
      this.#mode = "palette";
      return swallow({ type: "openKeymap" });
    }

    if (movesSlides(scope)) {
      if (ev.key === "ArrowRight" || ev.key === "PageDown") return swallow({ type: "nextSlide" });
      if (ev.key === "ArrowLeft" || ev.key === "PageUp") return swallow({ type: "prevSlide" });
      if (ev.key === " " || ev.key === "Spacebar") {
        return swallow(ev.shiftKey ? { type: "prevSlide" } : { type: "nextSlide" });
      }
      if (ev.key.length === 1 && ev.key >= "0" && ev.key <= "9") {
        this.#mode = "numberEntry";
        this.#digits = ev.key;
        return swallow({ type: "digitsChanged", digits: this.#digits });
      }
      // `n` is lecture only: review has no recorder clock to stamp a note
      // against, and a mode the student cannot leave a note from is worse than
      // no `n` at all.
      if (ev.key === "n" && scope === "lecture") {
        this.#mode = "noteInput";
        return swallow({ type: "openNote" });
      }
      if (ev.key === "e") return swallow({ type: "explainSelection" });
      if (ev.key === "t" || ev.key === "T") {
        return swallow({ type: "cycleTerm", direction: ev.shiftKey ? -1 : 1 });
      }
    }

    if (scope === "lecture") {
      if (ev.key === "-") return swallow({ type: "dim", delta: -1 });
      if (ev.key === "=") return swallow({ type: "dim", delta: +1 });
    }

    if (scope === "review") {
      // The rail's roving focus. `j` and `k` stop at the ends: falling off the
      // last note must not turn the page (architecture.md §9).
      if (ev.key === "j") return swallow({ type: "focusNext" });
      if (ev.key === "k") return swallow({ type: "focusPrev" });
      if (ev.key === "Enter") return swallow({ type: "activate" });
      if (ev.key === "g") return swallow({ type: "toggleGlossary" });
      if (ev.key === "o") return swallow({ type: "openObsidian" });
      if (ev.key === "]") return swallow({ type: "nextNotedPage" });
      if (ev.key === "[") return swallow({ type: "prevNotedPage" });
    }

    if (scope === "library") {
      if (ev.key === "j" || ev.key === "ArrowDown") return swallow({ type: "focusNext" });
      if (ev.key === "k" || ev.key === "ArrowUp") return swallow({ type: "focusPrev" });
      if (ev.key === "Enter") return swallow({ type: "activate" });
      if (ev.key === "r") return swallow({ type: "rescan" });
    }

    return passThrough();
  }
}

/**
 * Bind one router to one window. Returns the unbind function. The handler is
 * deliberately the only `keydown` listener the app installs.
 */
export function bindKeyRouter(
  router: KeyRouter,
  dispatch: (action: KeyAction) => void,
  target: Window = window,
): () => void {
  const onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.isComposing) return;
    const result = router.handle(ev);
    if (result.preventDefault) ev.preventDefault();
    for (const action of result.actions) dispatch(action);
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
