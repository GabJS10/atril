import { useCallback, useEffect, useReducer, useRef, type SyntheticEvent } from "react";
import { EMPTY, imageReducer, type Layer } from "./imageReducer";
import { fetchPageImage, PageFetchError } from "./pageFetch";

export type PageImageProps = {
  /** The image to show, or null when the page is off screen (nothing is kept then). */
  url: string | null;
  /** High for the pages in view, low for the neighbours. */
  priority: "high" | "low";
};

/** The image of one page. */
export function PageImage({ url, priority }: PageImageProps) {
  const [state, dispatch] = useReducer(imageReducer, EMPTY);
  const wanted = useRef<string | null>(url);
  const owned = useRef(new Set<string>());

  useEffect(() => {
    wanted.current = url;
    dispatch({ type: "want", url });
  }, [url]);

  // Blob URLs that came from a recovery are released as soon as no buffer holds them.
  useEffect(() => {
    const live = new Set<string>();
    for (const layer of [state.a, state.b]) if (layer?.owned) live.add(layer.src);
    for (const src of owned.current) {
      if (!live.has(src)) {
        URL.revokeObjectURL(src);
        owned.current.delete(src);
      }
    }
    for (const src of live) owned.current.add(src);
  }, [state]);
  useEffect(() => {
    const held = owned.current;
    return () => {
      wanted.current = null;
      for (const src of held) URL.revokeObjectURL(src);
      held.clear();
    };
  }, []);

  const onLoad = useCallback(
    (buffer: "a" | "b", attempt: number, event: SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget;
      const done = () => dispatch({ type: "loaded", buffer, attempt });
      // Decoding before the swap keeps the new image from showing up half drawn.
      if (typeof image.decode === "function") image.decode().then(done, done);
      else done();
    },
    [],
  );

  const onError = useCallback((buffer: "a" | "b", layer: Layer) => {
    const fail = () => dispatch({ type: "failed", buffer, attempt: layer.attempt });
    if (layer.owned) {
      fail();
      return;
    }
    // The <img> cannot say why. Ask again with fetch, which sees the status (410: asked again while wanted).
    fetchPageImage(layer.url, { isWanted: () => wanted.current === layer.url }).then(
      (blob) => {
        if (wanted.current !== layer.url) return;
        dispatch({ type: "recovered", buffer, attempt: layer.attempt, src: URL.createObjectURL(blob) });
      },
      (error: unknown) => {
        if (!(error instanceof PageFetchError) || error.reason !== "cancelled") fail();
      },
    );
  }, []);

  return (
    <>
      {(["a", "b"] as const).map((buffer) => {
        const layer = state[buffer];
        return (
          <img
            key={buffer}
            className="atril-page-image"
            data-buffer={buffer}
            data-front={state.front === buffer ? "true" : "false"}
            src={layer?.src}
            alt=""
            decoding="async"
            draggable={false}
            fetchPriority={priority}
            onLoad={layer ? (event) => onLoad(buffer, layer.attempt, event) : undefined}
            onError={layer ? () => onError(buffer, layer) : undefined}
          />
        );
      })}
    </>
  );
}
