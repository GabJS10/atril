import { useEffect, useState } from "react";

/**
 * `value`, but only after it has stayed the same for `delayMs`. While nothing has settled yet (the first value), the
 * value itself is returned, so the first request goes out at once. Used for the second step of the zoom: the sharp
 * image of the new scale is requested only when the zoom stops changing.
 */
export function useSettledValue<T>(value: T | null, delayMs: number): T | null {
  const [settled, setSettled] = useState<T | null>(null);
  // The first value settles at once (adjusting state while rendering, as React documents).
  if (value !== null && settled === null) setSettled(value);
  useEffect(() => {
    if (value === null) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled ?? value;
}
