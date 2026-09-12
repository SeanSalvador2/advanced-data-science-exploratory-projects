import { describe, expect, it } from "vitest";

import { KeyRouter, type KeyEventLike, type KeyScope } from "../src/keys/KeyRouter.ts";

function key(init: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return {
    code: init.code ?? "",
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  };
}

function router(scope: KeyScope = "lecture"): KeyRouter {
  return new KeyRouter({ scope });
}

describe("KeyRouter — idle in lecture", () => {
  it("moves slides with arrows, Space and the page keys", () => {
    const r = router();
    for (const k of ["ArrowRight", "PageDown", " "]) {
      const result = r.handle(key({ key: k }));
      expect(result.preventDefault).toBe(true);
      expect(result.actions).toEqual([{ type: "nextSlide" }]);
    }
    for (const k of ["ArrowLeft", "PageUp"]) {
      expect(r.handle(key({ key: k })).actions).toEqual([{ type: "prevSlide" }]);
    }
    expect(r.handle(key({ key: " ", shiftKey: true })).actions).toEqual([{ type: "prevSlide" }]);
  });

  it("dims and brightens, but only in lecture", () => {
    expect(router("lecture").handle(key({ key: "-" })).actions).toEqual([{ type: "dim", delta: -1 }]);
    expect(router("lecture").handle(key({ key: "=" })).actions).toEqual([{ type: "dim", delta: 1 }]);
    expect(router("library").handle(key({ key: "-" })).actions).toEqual([]);
  });

  it("stubs the lookup keys", () => {
    expect(router().handle(key({ key: "e" })).actions).toEqual([{ type: "explainSelection" }]);
    expect(router().handle(key({ key: "t" })).actions).toEqual([
      { type: "cycleTerm", direction: 1 },
    ]);
    expect(router().handle(key({ key: "T", shiftKey: true })).actions).toEqual([
      { type: "cycleTerm", direction: -1 },
    ]);
  });

  it("leaves unbound keys alone", () => {
    const result = router().handle(key({ key: "q" }));
    expect(result).toEqual({ preventDefault: false, actions: [] });
  });

  it("never touches a Cmd or Ctrl chord", () => {
    for (const ev of [
      key({ key: "ArrowRight", metaKey: true }),
      key({ key: "k", metaKey: true }),
      key({ key: "r", ctrlKey: true }),
      key({ key: "l", metaKey: true }),
    ]) {
      expect(router().handle(ev)).toEqual({ preventDefault: false, actions: [] });
    }
  });
});

describe("KeyRouter — numberEntry", () => {
  it("collects digits, echoes them, and jumps on Enter", () => {
    const r = router();
    expect(r.handle(key({ key: "1" })).actions).toEqual([{ type: "digitsChanged", digits: "1" }]);
    expect(r.mode).toBe("numberEntry");
    expect(r.handle(key({ key: "2" })).actions).toEqual([{ type: "digitsChanged", digits: "12" }]);
    expect(r.digits).toBe("12");
    expect(r.handle(key({ key: "Enter" })).actions).toEqual([
      { type: "digitsChanged", digits: "" },
      { type: "jumpSlide", slide: 12 },
    ]);
    expect(r.mode).toBe("idle");
  });

  it("edits with Backspace and falls back to idle when empty", () => {
    const r = router();
    r.handle(key({ key: "4" }));
    expect(r.handle(key({ key: "Backspace" })).actions).toEqual([
      { type: "digitsChanged", digits: "" },
    ]);
    expect(r.mode).toBe("idle");
  });

  it("clears on Esc without jumping", () => {
    const r = router();
    r.handle(key({ key: "9" }));
    const result = r.handle(key({ key: "Escape" }));
    expect(result.actions).toEqual([{ type: "digitsChanged", digits: "" }]);
    expect(r.mode).toBe("idle");
  });

  it("does not move the slide while digits are being typed", () => {
    const r = router();
    r.handle(key({ key: "3" }));
    expect(r.handle(key({ key: "ArrowRight" })).actions).toEqual([]);
    expect(r.mode).toBe("numberEntry");
  });

  it("refuses to jump to slide zero", () => {
    const r = router();
    r.handle(key({ key: "0" }));
    expect(r.handle(key({ key: "Enter" })).actions).toEqual([{ type: "digitsChanged", digits: "" }]);
  });
});

describe("KeyRouter — noteInput", () => {
  it("opens on n and swallows the n so it is not typed", () => {
    const r = router();
    const result = r.handle(key({ key: "n" }));
    expect(result).toEqual({ preventDefault: true, actions: [{ type: "openNote" }] });
    expect(r.mode).toBe("noteInput");
  });

  it("lets a bare n reach the input once it is open", () => {
    const r = router();
    r.handle(key({ key: "n" }));
    const typed = r.handle(key({ key: "n" }));
    expect(typed).toEqual({ preventDefault: false, actions: [] });
    expect(r.mode).toBe("noteInput");
  });

  it("lets every other printable key and the arrows through", () => {
    const r = router();
    r.handle(key({ key: "n" }));
    for (const k of ["e", "t", "j", "k", "-", "=", "1", " ", "?", "ArrowLeft", "ArrowRight"]) {
      expect(r.handle(key({ key: k }))).toEqual({ preventDefault: false, actions: [] });
    }
  });

  it("commits on Enter and cancels on Esc", () => {
    const r = router();
    r.handle(key({ key: "n" }));
    expect(r.handle(key({ key: "Enter" })).actions).toEqual([{ type: "commitNote" }]);
    expect(r.mode).toBe("idle");

    r.handle(key({ key: "n" }));
    expect(r.handle(key({ key: "Escape" })).actions).toEqual([{ type: "cancelNote" }]);
    expect(r.mode).toBe("idle");
  });

  it("intercepts the vertical arrows so they never reach the slide", () => {
    const r = router();
    r.handle(key({ key: "n" }));
    expect(r.handle(key({ key: "ArrowUp" }))).toEqual({ preventDefault: true, actions: [] });
  });
});

describe("KeyRouter — overlay and mode switching", () => {
  it("opens the keymap on ? and closes it on Esc", () => {
    const r = router();
    expect(r.handle(key({ key: "?", shiftKey: true })).actions).toEqual([{ type: "openKeymap" }]);
    expect(r.mode).toBe("palette");
    expect(r.handle(key({ key: "ArrowRight" })).actions).toEqual([]);
    expect(r.handle(key({ key: "Escape" })).actions).toEqual([{ type: "closeKeymap" }]);
    expect(r.mode).toBe("idle");
  });

  it("reads Option combos from the code, not the key", () => {
    const r = router();
    // macOS delivers Option+1 as "¡"; only the code identifies it.
    expect(r.handle(key({ key: "¡", code: "Digit1", altKey: true })).actions).toEqual([
      { type: "switchMode", target: "lecture" },
    ]);
    expect(r.handle(key({ key: "™", code: "Digit2", altKey: true })).actions).toEqual([
      { type: "switchMode", target: "review" },
    ]);
    expect(r.handle(key({ key: "£", code: "Digit3", altKey: true })).actions).toEqual([
      { type: "switchMode", target: "library" },
    ]);
    expect(r.handle(key({ key: "†", code: "KeyT", altKey: true })).actions).toEqual([
      { type: "toggleTheme" },
    ]);
  });

  it("backs out of a half-typed note before switching mode", () => {
    const r = router();
    r.handle(key({ key: "n" }));
    expect(r.handle(key({ key: "£", code: "Digit3", altKey: true })).actions).toEqual([
      { type: "cancelNote" },
      { type: "switchMode", target: "library" },
    ]);
    expect(r.mode).toBe("idle");
  });

  it("closes the card on Esc and otherwise behaves like idle", () => {
    const r = router();
    r.setMode("cardOpen");
    expect(r.handle(key({ key: "ArrowRight" })).actions).toEqual([{ type: "nextSlide" }]);
    expect(r.handle(key({ key: "Escape" })).actions).toEqual([{ type: "closeCard" }]);
    expect(r.mode).toBe("idle");
  });

  it("does nothing on Esc when nothing is open", () => {
    expect(router().handle(key({ key: "Escape" }))).toEqual({ preventDefault: false, actions: [] });
  });
});

describe("KeyRouter — library scope", () => {
  it("moves the cursor with j and k, opens with Enter, rescans with r", () => {
    const r = router("library");
    expect(r.handle(key({ key: "j" })).actions).toEqual([{ type: "focusNext" }]);
    expect(r.handle(key({ key: "k" })).actions).toEqual([{ type: "focusPrev" }]);
    expect(r.handle(key({ key: "ArrowDown" })).actions).toEqual([{ type: "focusNext" }]);
    expect(r.handle(key({ key: "Enter" })).actions).toEqual([{ type: "activate" }]);
    expect(r.handle(key({ key: "r" })).actions).toEqual([{ type: "rescan" }]);
  });

  it("does not open a note or type a slide number in the library", () => {
    const r = router("library");
    expect(r.handle(key({ key: "n" })).actions).toEqual([]);
    expect(r.handle(key({ key: "4" })).actions).toEqual([]);
    expect(r.mode).toBe("idle");
  });

  it("resets to idle when the screen changes", () => {
    const r = router("lecture");
    r.handle(key({ key: "n" }));
    expect(r.mode).toBe("noteInput");
    r.setScope("library");
    expect(r.mode).toBe("idle");
    expect(r.digits).toBe("");
  });
});
