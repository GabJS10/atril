import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHROME_HIDE_DELAY_MS, useChromeVisibility } from "./useChromeVisibility";

describe("useChromeVisibility", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts hidden and shows on wake, then hides after 2 s without movement", () => {
    const { result } = renderHook(() => useChromeVisibility());
    expect(result.current.visible).toBe(false);

    act(() => result.current.wake());
    expect(result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS - 1));
    expect(result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.visible).toBe(false);
  });

  it("restarts the timer on every wake", () => {
    const { result } = renderHook(() => useChromeVisibility());

    act(() => result.current.wake());
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.wake());
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.visible).toBe(true);

    act(() => vi.advanceTimersByTime(500));
    expect(result.current.visible).toBe(false);
  });

  it("stays visible while pinned (focus inside the bar)", () => {
    const { result } = renderHook(() => useChromeVisibility());

    act(() => result.current.pin(true));
    act(() => vi.advanceTimersByTime(CHROME_HIDE_DELAY_MS * 3));
    expect(result.current.visible).toBe(true);

    act(() => result.current.pin(false));
    expect(result.current.visible).toBe(false);
  });
});
