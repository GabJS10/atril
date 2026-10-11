// Whether a reader is open. The indexer waits while it is, so it never competes with the page being read.

let openReaders = 0;
let idleWaiters: (() => void)[] = [];

export function readerOpened(): void {
  openReaders += 1;
}

export function readerClosed(): void {
  openReaders = Math.max(0, openReaders - 1);
  if (openReaders === 0) {
    const waiting = idleWaiters;
    idleWaiters = [];
    for (const resolve of waiting) resolve();
  }
}

export function isReaderOpen(): boolean {
  return openReaders > 0;
}

/** Resolves when no reader is open (immediately if none is). */
export function whenReaderIdle(): Promise<void> {
  if (!isReaderOpen()) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}

/** Test helper: forgets every reader and waiter. */
export function resetReaderActivity(): void {
  openReaders = 0;
  idleWaiters = [];
}
