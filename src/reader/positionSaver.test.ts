import { mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingStateInput } from "../api/types";
import { saveReadingState } from "../api/tauri";
import { createPositionSaver, SAVE_DEBOUNCE_MS } from "./positionSaver";

function state(page: number): ReadingStateInput {
  return { page, offsetInPage: 0, zoom: "page_width", viewMode: "normal", pageCount: 400 };
}

/** A save that stays pending until the test resolves it. */
function deferredSave() {
  const calls: ReadingStateInput[] = [];
  const resolvers: (() => void)[] = [];
  const save = vi.fn((next: ReadingStateInput) => {
    calls.push(next);
    return new Promise<void>((resolve) => resolvers.push(resolve));
  });
  return { save, calls, resolveNext: () => resolvers.shift()?.() };
}

describe("createPositionSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ignores updates until it is enabled, so the first open cannot save page 1", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createPositionSaver({ save });

    saver.update(state(1));
    await saver.flush();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);

    expect(save).not.toHaveBeenCalled();
    expect(saver.isDirty()).toBe(false);
  });

  it("saves the latest state once, after 800 ms without updates", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createPositionSaver({ save });
    saver.enable();

    saver.update(state(10));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    saver.update(state(150));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(state(150));
  });

  it("flush saves the pending state now and resolves when it is stored", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createPositionSaver({ save });
    saver.enable();

    saver.update(state(150));
    await saver.flush();

    expect(save).toHaveBeenCalledWith(state(150));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush does nothing when nothing is pending", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const saver = createPositionSaver({ save });
    saver.enable();

    await saver.flush();

    expect(save).not.toHaveBeenCalled();
  });

  it("sends saves one at a time and in order", async () => {
    const { save, calls, resolveNext } = deferredSave();
    const saver = createPositionSaver({ save });
    saver.enable();

    saver.update(state(1));
    void saver.flush();
    saver.update(state(2));
    const second = saver.flush();

    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([state(1)]);
    resolveNext();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([state(1), state(2)]);
    resolveNext();
    await second;
    expect(saver.isDirty()).toBe(false);
  });

  it("reports dirty while a state is pending or in flight", async () => {
    const { save, resolveNext } = deferredSave();
    const saver = createPositionSaver({ save });
    saver.enable();

    expect(saver.isDirty()).toBe(false);
    saver.update(state(3));
    expect(saver.isDirty()).toBe(true);

    const flushed = saver.flush();
    expect(saver.isDirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    resolveNext();
    await flushed;
    expect(saver.isDirty()).toBe(false);
  });

  it("keeps a failed state pending and sends it again on the next flush", async () => {
    const onError = vi.fn();
    const save = vi
      .fn<(next: ReadingStateInput) => Promise<void>>()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const saver = createPositionSaver({ save, onError });
    saver.enable();

    saver.update(state(42));
    await saver.flush();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(saver.isDirty()).toBe(true);

    await saver.flush();
    expect(save).toHaveBeenLastCalledWith(state(42));
    expect(saver.isDirty()).toBe(false);
  });
});

describe("createPositionSaver with the save_reading_state command", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls save_reading_state with the book id and the state", async () => {
    const commands: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      commands.push({ cmd, args });
      return null;
    });
    const saver = createPositionSaver({ save: (next) => saveReadingState("abc", next) });
    saver.enable();

    saver.update(state(150));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(commands).toEqual([{ cmd: "save_reading_state", args: { bookId: "abc", state: state(150) } }]);
  });
});
