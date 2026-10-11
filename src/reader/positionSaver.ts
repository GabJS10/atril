import type { ReadingStateInput } from "../api/types";

/** Quiet time before a position is saved (roadmap 1.F3). */
export const SAVE_DEBOUNCE_MS = 800;

export type PositionSaver = {
  /** Allows saving. Called once the saved position is on screen; before that, updates are ignored. */
  enable: () => void;
  /** Stores the latest position and restarts the debounce. */
  update: (state: ReadingStateInput) => void;
  /** True while a position is waiting to be saved or a save is in flight. */
  isDirty: () => boolean;
  /** Saves the pending position now, without waiting for the debounce. Resolves when it is stored. */
  flush: () => Promise<void>;
};

export type PositionSaverOptions = {
  save: (state: ReadingStateInput) => Promise<unknown>;
  onError?: (error: unknown) => void;
  delayMs?: number;
};

/**
 * Debounced writer of the reading position. Saves are sent one at a time and in order. A failed
 * save keeps its state pending, so the next update or flush sends it again.
 */
export function createPositionSaver(options: PositionSaverOptions): PositionSaver {
  const delayMs = options.delayMs ?? SAVE_DEBOUNCE_MS;
  let enabled = false;
  let pending: ReadingStateInput | null = null;
  let inFlight = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();

  function cancelTimer() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function persist(): Promise<void> {
    cancelTimer();
    const state = pending;
    if (!state) return queue;
    pending = null;
    inFlight += 1;
    queue = queue
      .then(() => options.save(state).then(() => undefined))
      .catch((error: unknown) => {
        pending ??= state;
        options.onError?.(error);
      })
      .finally(() => {
        inFlight -= 1;
      });
    return queue;
  }

  return {
    enable() {
      enabled = true;
    },
    update(state) {
      if (!enabled) return;
      pending = state;
      cancelTimer();
      timer = setTimeout(() => {
        timer = undefined;
        void persist();
      }, delayMs);
    },
    isDirty() {
      return pending !== null || inFlight > 0;
    },
    flush() {
      if (pending === null) return queue;
      return persist();
    },
  };
}
