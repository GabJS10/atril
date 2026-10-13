/** One of the two image buffers of a page: the URL it stands for and what its `<img>` loads. */
export type Layer = { url: string; src: string; owned: boolean; attempt: number };

export type State = {
  a: Layer | null;
  b: Layer | null;
  /** The buffer on screen. The other one loads the next image behind it. */
  front: "a" | "b" | null;
  attempts: number;
};

export type Action =
  | { type: "want"; url: string | null }
  | { type: "loaded"; buffer: "a" | "b"; attempt: number }
  | { type: "recovered"; buffer: "a" | "b"; attempt: number; src: string }
  | { type: "failed"; buffer: "a" | "b"; attempt: number };

export const EMPTY: State = { a: null, b: null, front: null, attempts: 0 };

const other = (buffer: "a" | "b"): "a" | "b" => (buffer === "a" ? "b" : "a");

/**
 * Two buffers: the image on screen stays until the next one (another scale after a zoom) has loaded and decoded, then
 * they swap and the old one is released. The page never goes blank between two sharpnesses.
 */
export function imageReducer(state: State, action: Action): State {
  switch (action.type) {
    case "want": {
      if (action.url === null) return state.a || state.b ? { ...EMPTY, attempts: state.attempts } : state;
      const front = state.front ? state[state.front] : null;
      if (front?.url === action.url) {
        // Back to the image on screen: whatever was loading behind it is dropped.
        return state.front && state[other(state.front)] ? { ...state, [other(state.front)]: null } : state;
      }
      const back = state.front ? other(state.front) : "a";
      if (state[back]?.url === action.url) return state;
      const attempt = state.attempts + 1;
      return {
        ...state,
        [back]: { url: action.url, src: action.url, owned: false, attempt },
        attempts: attempt,
      };
    }
    case "loaded": {
      const layer = state[action.buffer];
      if (!layer || layer.attempt !== action.attempt || state.front === action.buffer) return state;
      return { ...state, front: action.buffer, [other(action.buffer)]: null };
    }
    case "recovered": {
      const layer = state[action.buffer];
      if (!layer || layer.attempt !== action.attempt) return state;
      return { ...state, [action.buffer]: { ...layer, src: action.src, owned: true } };
    }
    case "failed": {
      const layer = state[action.buffer];
      if (!layer || layer.attempt !== action.attempt || state.front === action.buffer) return state;
      return { ...state, [action.buffer]: null };
    }
  }
}
