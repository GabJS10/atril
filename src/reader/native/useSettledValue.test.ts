import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettledValue } from "./useSettledValue";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useSettledValue", () => {
  it("returns the first value at once and keeps it until the new one has been still for the delay", () => {
    const { result, rerender } = renderHook(({ value }) => useSettledValue<number>(value, 150), {
      initialProps: { value: 1 as number | null },
    });
    expect(result.current).toBe(1);

    rerender({ value: 2 });
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(100));
    rerender({ value: 3 });
    act(() => void vi.advanceTimersByTime(100));
    expect(result.current).toBe(1);
    act(() => void vi.advanceTimersByTime(60));
    expect(result.current).toBe(3);
  });

  it("is null while there is no value and takes the first one without waiting", () => {
    const { result, rerender } = renderHook(({ value }) => useSettledValue<number>(value, 150), {
      initialProps: { value: null as number | null },
    });
    expect(result.current).toBeNull();
    rerender({ value: 5 });
    expect(result.current).toBe(5);
    rerender({ value: 6 });
    expect(result.current).toBe(5);
  });
});
