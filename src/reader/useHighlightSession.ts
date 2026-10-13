import { useCallback, useEffect, useState } from "react";
import type { HighlightColor } from "../api/types";
import { useT } from "../i18n";
import { currentHighlightId, useHighlightActions, useHighlights } from "./highlights";
import type { SelectionPart } from "./native/textSelection";

/** A text selection on screen: what it covers, and where the toolbar should sit. */
export type ActiveSelection = { parts: SelectionPart[]; anchor: DOMRect };

/** The highlight whose editor is open. */
export type EditingHighlight = { id: string; anchor: DOMRect; focusNote: boolean };

const NOTICE_MS = 4000;

/**
 * Everything the reader does with highlights: the selection toolbar, the highlighter mode (H), the editor of
 * an existing highlight, and the discreet notice when a change is refused.
 */
export function useHighlightSession(bookId: string) {
  const t = useT();
  const [notice, setNotice] = useState<string | null>(null);
  const highlights = useHighlights(bookId);
  const actions = useHighlightActions(bookId, () => setNotice(t("highlight.saveFailed")));
  const [highlightMode, setHighlightMode] = useState(false);
  const [lastColor, setLastColor] = useState<HighlightColor>("ochre");
  const [selection, setSelection] = useState<ActiveSelection | null>(null);
  const [editing, setEditing] = useState<EditingHighlight | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleHighlightMode = useCallback(() => setHighlightMode((value) => !value), []);

  const clearNativeSelection = () => window.getSelection()?.removeAllRanges();

  /** One highlight per page the selection touches. Resolves to the first one's id. */
  const createFor = (parts: SelectionPart[], color: HighlightColor, note: string | null = null) => {
    let first: Promise<string> | undefined;
    for (const part of parts) {
      const request = actions.create({ page: part.page, rects: part.rects, text: part.text, color, note });
      request.catch(() => undefined);
      first ??= request;
    }
    return first;
  };

  const onSelectionEnd = (parts: SelectionPart[], anchor: DOMRect) => {
    // A new selection replaces the editor of an older highlight.
    setEditing(null);
    if (highlightMode) {
      createFor(parts, lastColor);
      clearNativeSelection();
      setSelection(null);
      return;
    }
    setSelection({ parts, anchor });
  };

  const onSelectionClear = () => {
    setSelection(null);
    setEditing(null);
  };

  const onHighlightPress = (id: string, anchor: DOMRect) => {
    setSelection(null);
    setEditing({ id, anchor, focusNote: false });
  };

  const pick = (color: HighlightColor) => {
    if (!selection) return;
    setLastColor(color);
    createFor(selection.parts, color);
    clearNativeSelection();
    setSelection(null);
  };

  const note = () => {
    if (!selection) return;
    const { anchor } = selection;
    const created = createFor(selection.parts, lastColor);
    clearNativeSelection();
    setSelection(null);
    created?.then(
      (id) => setEditing({ id, anchor, focusNote: true }),
      () => undefined,
    );
  };

  const copy = () => {
    if (!selection) return;
    const text = selection.parts.map((part) => part.copyText ?? part.text).join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  };

  const current = editing
    ? highlights.data?.find((item) => item.id === currentHighlightId(editing.id))
    : undefined;

  return {
    highlights: highlights.data ?? [],
    highlightMode,
    toggleHighlightMode,
    lastColor,
    selection,
    editing:
      editing && current
        ? { highlight: current, anchor: editing.anchor, focusNote: editing.focusNote }
        : null,
    notice,
    showNotice: (message: string) => setNotice(message),
    dismissNotice: () => setNotice(null),
    handlers: { onSelectionEnd, onSelectionClear, onHighlightPress },
    toolbar: { pick, note, copy },
    editor: {
      close: () => setEditing(null),
      changeColor: (id: string, color: HighlightColor) => {
        setLastColor(color);
        void actions.update(id, { color });
      },
      saveNote: (id: string, text: string) => void actions.update(id, { note: text.trim() ? text : null }),
      remove: (id: string) => {
        setEditing(null);
        void actions.remove(id);
      },
    },
  };
}
