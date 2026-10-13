import { describe, expect, it } from "vitest";
import { EMPTY, imageReducer, type State } from "./imageReducer";

const want = (state: State, url: string | null) => imageReducer(state, { type: "want", url });

describe("imageReducer", () => {
  it("loads the first image in a buffer behind nothing, and shows it when it has loaded", () => {
    const loading = want(EMPTY, "u1");
    expect(loading.front).toBeNull();
    expect(loading.a?.url).toBe("u1");
    const shown = imageReducer(loading, { type: "loaded", buffer: "a", attempt: loading.a!.attempt });
    expect(shown.front).toBe("a");
  });

  it("keeps the image on screen while the next one loads, then swaps and releases the old one", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "loaded", buffer: "a", attempt: state.a!.attempt });
    state = want(state, "u2");
    expect(state.front).toBe("a");
    expect(state.a?.url).toBe("u1");
    expect(state.b?.url).toBe("u2");
    state = imageReducer(state, { type: "loaded", buffer: "b", attempt: state.b!.attempt });
    expect(state.front).toBe("b");
    expect(state.a).toBeNull();
  });

  it("replaces the image in flight when the scale changes again", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "loaded", buffer: "a", attempt: state.a!.attempt });
    state = want(state, "u2");
    const stale = state.b!.attempt;
    state = want(state, "u3");
    expect(state.b?.url).toBe("u3");
    // A load event of the replaced image does nothing.
    expect(imageReducer(state, { type: "loaded", buffer: "b", attempt: stale })).toBe(state);
  });

  it("drops the pending image when the wanted one is the one already on screen", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "loaded", buffer: "a", attempt: state.a!.attempt });
    state = want(state, "u2");
    state = want(state, "u1");
    expect(state.b).toBeNull();
    expect(state.front).toBe("a");
  });

  it("keeps the image on screen when the next one fails", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "loaded", buffer: "a", attempt: state.a!.attempt });
    state = want(state, "u2");
    state = imageReducer(state, { type: "failed", buffer: "b", attempt: state.b!.attempt });
    expect(state.b).toBeNull();
    expect(state.front).toBe("a");
  });

  it("swaps the source for a recovered blob and keeps the url", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "recovered", buffer: "a", attempt: state.a!.attempt, src: "blob:x" });
    expect(state.a).toMatchObject({ url: "u1", src: "blob:x", owned: true });
  });

  it("releases everything when the page leaves the view", () => {
    let state = want(EMPTY, "u1");
    state = imageReducer(state, { type: "loaded", buffer: "a", attempt: state.a!.attempt });
    state = want(state, null);
    expect(state.a).toBeNull();
    expect(state.b).toBeNull();
    expect(state.front).toBeNull();
    // Attempt numbers keep growing, so a late event of the old image cannot match a new one.
    const again = want(state, "u1");
    expect(again.a!.attempt).toBeGreaterThan(1);
  });
});
