import { useEffect, useMemo } from "react";
import { destroyWindow, onWindowCloseRequested, saveReadingState } from "../api/tauri";
import { createPositionSaver, type PositionSaver } from "./positionSaver";

/**
 * The reading position of one book, saved with a debounce. The pending position is also saved when
 * the window loses focus or is hidden, when the reader is left, and before the window closes: the
 * close waits for the save, and stays open if the save fails.
 */
export function useReadingPosition(bookId: string): PositionSaver {
  const saver = useMemo(
    () =>
      createPositionSaver({
        save: (state) => saveReadingState(bookId, state),
        onError: (error) => console.error("could not save the reading position", error),
      }),
    [bookId],
  );

  useEffect(() => {
    const flush = () => void saver.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("blur", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      void saver.flush();
    };
  }, [saver]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let unmounted = false;

    Promise.resolve()
      .then(() =>
        onWindowCloseRequested(async (event) => {
          if (!saver.isDirty()) return;
          event.preventDefault();
          await saver.flush();
          if (!saver.isDirty()) await destroyWindow();
        }),
      )
      .then(
        (unlisten) => {
          if (unmounted) unlisten();
          else stop = unlisten;
        },
        () => undefined, // Not running inside Tauri (e.g. the Vite dev server in a browser).
      );

    return () => {
      unmounted = true;
      stop?.();
    };
  }, [saver]);

  return saver;
}
