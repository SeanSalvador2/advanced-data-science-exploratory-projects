import type { Event } from "@lecture/core";

import type { LectureFolder } from "../storage/LectureFolder.ts";

/** How long after the last enqueue an idle flush fires. */
export const IDLE_FLUSH_MS = 3000;

export interface EventBufferOptions {
  folder: LectureFolder;
  /** Defaults to `events.jsonl`. */
  file?: string;
  idleMs?: number;
  /** Called when a flush fails; the events stay queued for the next try. */
  onError?: (err: unknown) => void;
  /** Called after `pending` changes, so the strip can show a count. */
  onChange?: (pending: number) => void;
}

/**
 * Queues `Event` records and writes them as JSONL, never per keystroke.
 *
 * A writable stream only reaches disk on close and appending rewrites the
 * file's tail, so flushing on every keypress would be both slow and lossy
 * (phase-2-research.md §4). Flushes happen on slide change, window blur,
 * `visibilitychange` to hidden, `pagehide`, three seconds after the last
 * enqueue, and on an explicit `flush()`.
 */
export class EventBuffer {
  readonly #folder: LectureFolder;
  readonly #file: string;
  readonly #idleMs: number;
  readonly #onError: (err: unknown) => void;
  readonly #onChange: ((pending: number) => void) | undefined;

  #queue: Event[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #inFlight: Promise<void> = Promise.resolve();
  #detach: Array<() => void> = [];

  constructor(options: EventBufferOptions) {
    this.#folder = options.folder;
    this.#file = options.file ?? "events.jsonl";
    this.#idleMs = options.idleMs ?? IDLE_FLUSH_MS;
    this.#onError = options.onError ?? ((err) => console.error("event flush failed", err));
    this.#onChange = options.onChange;
  }

  get pending(): number {
    return this.#queue.length;
  }

  enqueue(event: Event): void {
    this.#queue.push(event);
    this.#onChange?.(this.#queue.length);
    this.#restartIdleTimer();
  }

  #restartIdleTimer(): void {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.flush();
    }, this.#idleMs);
  }

  #clearIdleTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /**
   * Write everything queued. Flushes are serialised through one promise chain
   * so two triggers a millisecond apart cannot interleave two appends to the
   * same file. A failed write puts its events back at the head of the queue.
   */
  flush(): Promise<void> {
    this.#clearIdleTimer();
    this.#inFlight = this.#inFlight.then(async () => {
      if (this.#queue.length === 0) return;
      const batch = this.#queue;
      this.#queue = [];
      this.#onChange?.(0);
      try {
        await this.#folder.appendLines(this.#file, batch.map((e) => JSON.stringify(e)));
      } catch (err) {
        this.#queue = [...batch, ...this.#queue];
        this.#onChange?.(this.#queue.length);
        this.#onError(err);
      }
    });
    return this.#inFlight;
  }

  /**
   * Bind the lifecycle flush triggers. `pagehide` is the last point Chrome
   * reliably gives a page, and `visibilitychange` covers tab switches, which
   * is when a lecture laptop is most likely to be put to sleep.
   */
  attach(target: Window = window): () => void {
    const onBlur = (): void => void this.flush();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") void this.flush();
    };
    const onPageHide = (): void => void this.flush();
    target.addEventListener("blur", onBlur);
    target.document.addEventListener("visibilitychange", onVisibility);
    target.addEventListener("pagehide", onPageHide);
    const detach = (): void => {
      target.removeEventListener("blur", onBlur);
      target.document.removeEventListener("visibilitychange", onVisibility);
      target.removeEventListener("pagehide", onPageHide);
    };
    this.#detach.push(detach);
    return detach;
  }

  /** Stop the idle timer and unbind listeners; does not flush. */
  dispose(): void {
    this.#clearIdleTimer();
    for (const d of this.#detach) d();
    this.#detach = [];
  }
}
