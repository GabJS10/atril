import { memo, useLayoutEffect, useRef } from "react";
import type { TextWord } from "../../api/types";
import { stretchFor, wordStyle } from "./textLayer";
import { layerWords, TEXT_LAYER_CLASS, TEXT_WORD_CLASS } from "./textSelection";

/**
 * The invisible text of one page, over its image, so the text can be selected and copied. One absolutely placed span
 * per word, in the page's own units (points): the layer around it is scaled to the zoom with a CSS transform, so it
 * follows the page at once, while the sharp image of a new zoom is still on its way.
 *
 * The browser lays each word out in its own font; a read of all the widths, then one write of all the stretches,
 * makes every word as wide as the box the engine measured, so the selection and the caret fall where the words are.
 */
export const TextLayer = memo(function TextLayer({ words }: { words: TextWord[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const layer = ref.current;
    if (!layer) return;
    layerWords.set(layer, words);
    const spans = Array.from(layer.children) as HTMLElement[];
    const natural = spans.map((span) => span.offsetWidth);
    spans.forEach((span, index) => {
      const word = words[index];
      const stretch = word ? stretchFor(word.rect, natural[index] ?? 0) : 1;
      span.style.transform = stretch === 1 ? "" : `scaleX(${stretch})`;
    });
  }, [words]);

  return (
    <div ref={ref} className={TEXT_LAYER_CLASS}>
      {words.map((word, index) => {
        const style = wordStyle(word.rect);
        return (
          <span
            key={index}
            className={TEXT_WORD_CLASS}
            style={{
              left: style.left,
              top: style.top,
              height: style.height,
              fontSize: style.fontSize,
              lineHeight: `${style.height}px`,
            }}
          >
            {word.text}
          </span>
        );
      })}
    </div>
  );
});
