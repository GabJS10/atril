import { useCallback, useEffect, useRef, useState } from "react";

/** How long the reader bar stays after the last pointer movement (DESIGN.md, componente "Barra del lector"). */
export const CHROME_HIDE_DELAY_MS = 2000;

/**
 * Visibility of the reader bar. `wake()` shows it and restarts the timer (pointer movement);
 * `pin(true)` keeps it visible while focus is inside it, so keyboard users can reach its controls.
 */
export function useChromeVisibility(delayMs: number = CHROME_HIDE_DELAY_MS) {
  const [awake, setAwake] = useState(false);
  const [pinned, setPinned] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAwake(false), delayMs);
  }, [delayMs]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { visible: awake || pinned, wake, pin: setPinned };
}
