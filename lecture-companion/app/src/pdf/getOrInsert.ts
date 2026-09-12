/**
 * `Map.prototype.getOrInsert` / `getOrInsertComputed` and their WeakMap twins.
 *
 * pdf.js 6.3 uses these on both the main thread and inside its worker. They
 * are new enough that the Chromium pinned in this repo's test container (141)
 * does not have them, though current Chrome, which is what the app actually
 * runs on, does. The shim is feature detected, so on a browser that has the
 * real methods this module does nothing at all.
 *
 * Semantics follow the proposal: look the key up, and only call the callback
 * and store when it is absent.
 */

/** Captured before the shim runs, so it reports the engine, not this module. */
const NATIVE =
  typeof (Map.prototype as unknown as Record<string, unknown>)["getOrInsertComputed"] ===
    "function" &&
  typeof (WeakMap.prototype as unknown as Record<string, unknown>)["getOrInsertComputed"] ===
    "function";

type Insertable = {
  has(key: unknown): boolean;
  get(key: unknown): unknown;
  set(key: unknown, value: unknown): unknown;
};

function install(proto: object, name: string, computed: boolean): void {
  if (typeof (proto as Record<string, unknown>)[name] === "function") return;
  Object.defineProperty(proto, name, {
    value: function (this: Insertable, key: unknown, second: unknown): unknown {
      if (this.has(key)) return this.get(key);
      const value = computed ? (second as (k: unknown) => unknown)(key) : second;
      this.set(key, value);
      return value;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

export function installGetOrInsert(): void {
  for (const proto of [Map.prototype, WeakMap.prototype]) {
    install(proto, "getOrInsert", false);
    install(proto, "getOrInsertComputed", true);
  }
}

/** True when the engine already had them, so no shim is needed in the worker. */
export function hasGetOrInsert(): boolean {
  return NATIVE;
}

installGetOrInsert();
