import { runIndexer, type IndexerDeps } from "./indexer";

let running: Promise<void> | null = null;
let again = false;

/**
 * Starts an indexing run, or asks the current one to run again when it finishes (new books arrived
 * meanwhile). At most one run is active at a time.
 */
export function scheduleIndexing(deps: IndexerDeps): void {
  if (running) {
    again = true;
    return;
  }
  running = (async () => {
    do {
      again = false;
      try {
        await runIndexer(deps);
      } catch (error) {
        console.error(`the indexer stopped: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    } while (again);
  })().finally(() => {
    running = null;
  });
}

/** Test helper: waits for the active run, if any. */
export function whenIndexingIdle(): Promise<void> {
  return running ?? Promise.resolve();
}
